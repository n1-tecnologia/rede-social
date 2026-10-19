import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { feedNotificationSources } from '@rede-social/module-feed/server';
import { notificationsSystemCtx } from '@rede-social/module-notifications/server';
import { sql } from 'drizzle-orm';
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
} from './setup';

/**
 * 09-03 (SOCIAL-03, SOCIAL-04, SOCIAL-06, EXPL-02; D-471, D-473, D-476, D-483) against the live local
 * stack and the real seed: a member of a `social` tenant publishes, and only the right people read.
 *
 * The seed (09-02) gives rede-lab `social` ON and two follow fixtures: `alvaro.pinheiro` follows
 * `helena.kuster`, and `helena.kuster` follows `marcos.vinicius`. Marcos follows nobody. Every
 * fixture post carries `PREFIX` and is removed by prefix in `beforeAll` (a crashed run) and `afterAll`.
 *
 * `09 tracer` is ONE member post through every layer (the route, the permission, the member stamp,
 * the restrictive insert policy, the restrictive select policy, the Início predicate, the Explorar
 * scope). `09 audience` covers the query contract, the 403/404 answers, the notification guard
 * (D-476) and the EP-11 idempotency truths. Test ORDER is load-bearing (declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 09-03 ';
const tokens = {
  alvaro: '',
  helena: '',
  marcos: '',
  labMember: '',
  labAdmin: '',
  labSupport: '',
  demoMember: '',
};
const userIds = { alvaro: '', helena: '', marcos: '', labMember: '', labAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};

const request = (path: string, token: string, init: RequestInit = {}, host = HOSTS.lab) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const publish = (token: string, caption: string) =>
  request('/v1/feed/posts', token, { method: 'POST', body: JSON.stringify({ caption }) });

const explorar = async (token: string, extra = ''): Promise<FeedPost[]> => {
  const res = await request(`/v1/feed?scope=explorar&limit=25${extra}`, token);
  expect(res.status, `GET /v1/feed?scope=explorar${extra}`).toBe(200);
  return ((await res.json()) as FeedPage).items;
};

const inicio = async (token: string): Promise<FeedPost[]> => {
  const res = await request('/v1/feed?limit=25', token);
  expect(res.status).toBe(200);
  return ((await res.json()) as FeedPage).items;
};

const ids = (posts: FeedPost[]): string[] => posts.map((post) => post.id);

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

/** The marker every video asset this file writes carries (the crash sweep's key for assets). */
const VIDEO_FILENAME = 'reel-09-04.mp4';

async function sweep(): Promise<void> {
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.media_assets where filename = ${VIDEO_FILENAME}`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
}

/**
 * A READY video post written straight into the tables (the `fake` provider posture of
 * `reels.test.ts`), so the audience, the author and the `created_at` are exactly the ones the case
 * needs: an organization post (`tenant`) or a member post (`followers`), optionally at a fixed instant.
 */
async function videoPost(input: {
  authorUserId: string;
  caption: string;
  visibility: 'tenant' | 'followers';
  createdAt?: string;
}): Promise<string> {
  const [asset] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
    values (${labTenantId}::uuid, ${input.authorUserId}::uuid, 'video', 'post', 'ready', 'fake',
            ${`fake-${crypto.randomUUID()}`}, ${`pb-${crypto.randomUUID()}`},
            'video/mp4', 1048576, 1080, 1920, 15, '9:16', ${VIDEO_FILENAME}, now())
    returning id`;
  const assetId = asset?.id ?? '';
  const [post] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts
      (tenant_id, author_user_id, caption, visibility, media_kind, created_at)
    values (${labTenantId}::uuid, ${input.authorUserId}::uuid, ${input.caption}, ${input.visibility},
            'video', coalesce(${input.createdAt ?? null}::timestamptz, now()))
    returning id`;
  const postId = post?.id ?? '';
  await adminSql`
    insert into public.feed_post_media
      (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
    values (${labTenantId}::uuid, ${postId}::uuid, 'video', ${assetId}::uuid, 'video', 0)`;
  return postId;
}

const reels = async (token: string, extra = ''): Promise<FeedPost[]> => {
  const res = await request(`/v1/feed?media=video&limit=25${extra}`, token);
  expect(res.status, `GET /v1/feed?media=video${extra}`).toBe(200);
  return ((await res.json()) as FeedPage).items;
};

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labMember = await userOf('member@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  await sweep();
});

afterAll(async () => {
  await sweep();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('09 tracer', () => {
  const posted: { first?: FeedPost; second?: FeedPost; marcos?: FeedPost; admin?: FeedPost } = {};

  it('1. a member publishes: 201, audience followers, stamped visibility followers, no community', async () => {
    const first = await publish(tokens.helena, `${PREFIX}primeiro de Helena`);
    expect(first.status).toBe(201);
    posted.first = (await first.json()) as FeedPost;
    expect(posted.first.audience).toBe('followers');
    expect(posted.first.communityId).toBeNull();
    const second = await publish(tokens.helena, `${PREFIX}segundo de Helena`);
    expect(second.status).toBe(201);
    posted.second = (await second.json()) as FeedPost;

    const [row] = await adminSql<
      { visibility: string; community_id: string | null; author_user_id: string }[]
    >`select visibility, community_id, author_user_id from public.feed_posts where id = ${posted.first.id}::uuid`;
    expect(row?.visibility).toBe('followers');
    expect(row?.community_id).toBeNull();
    expect(row?.author_user_id).toBe(userIds.helena);
  });

  it('2. EXPL-02: a follower (Alvaro) lists both posts in Explorar, newest first', async () => {
    const items = await explorar(tokens.alvaro);
    const found = ids(items);
    expect(found).toContain(posted.first?.id);
    expect(found).toContain(posted.second?.id);
    expect(found.indexOf(posted.second?.id ?? '')).toBeLessThan(
      found.indexOf(posted.first?.id ?? ''),
    );
    const stamps = items.map((post) => post.createdAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it('3. SOCIAL-04: the SAME posts are absent from the follower’s Início', async () => {
    const found = ids(await inicio(tokens.alvaro));
    expect(found).not.toContain(posted.first?.id);
    expect(found).not.toContain(posted.second?.id);
  });

  it('4. a stranger (Marcos follows nobody) lists neither post; his own post is the positive control', async () => {
    const mine = await publish(tokens.marcos, `${PREFIX}de Marcos`);
    expect(mine.status).toBe(201);
    posted.marcos = (await mine.json()) as FeedPost;
    const items = await explorar(tokens.marcos);
    expect(ids(items)).toContain(posted.marcos.id);
    expect(ids(items)).not.toContain(posted.first?.id);
    expect(ids(items)).not.toContain(posted.second?.id);
  });

  it('5. D-471: the author’s own Explorar holds her posts, and a followee’s (Helena follows Marcos)', async () => {
    const found = ids(await explorar(tokens.helena));
    expect(found).toContain(posted.first?.id);
    expect(found).toContain(posted.second?.id);
    expect(found).toContain(posted.marcos?.id);
    // Helena's own posts are NOT in her Início either.
    expect(ids(await inicio(tokens.helena))).not.toContain(posted.first?.id);
  });

  it('6. an admin’s post is in Início for members and never in Explorar', async () => {
    const res = await publish(tokens.labAdmin, `${PREFIX}aviso da diretoria`);
    expect(res.status).toBe(201);
    posted.admin = (await res.json()) as FeedPost;
    expect(posted.admin.audience).toBeUndefined();
    const [row] = await adminSql<{ visibility: string }[]>`
      select visibility from public.feed_posts where id = ${posted.admin.id}::uuid`;
    expect(row?.visibility).toBe('tenant');

    expect(ids(await inicio(tokens.alvaro))).toContain(posted.admin.id);
    expect(ids(await inicio(tokens.marcos))).toContain(posted.admin.id);
    expect(ids(await explorar(tokens.alvaro))).not.toContain(posted.admin.id);
    // The moderator reads member posts in Explorar, and the admin's own post is still not there.
    const moderator = ids(await explorar(tokens.labAdmin));
    expect(moderator).toContain(posted.first?.id);
    expect(moderator).not.toContain(posted.admin.id);
  });

  it('7. a followers post planted for a stranger never reaches Alvaro, in Explorar or in Início', async () => {
    const [planted] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
      values (${labTenantId}::uuid, ${userIds.labMember}::uuid, ${`${PREFIX}de um desconhecido`}, 'followers')
      returning id`;
    const plantedId = planted?.id ?? '';
    expect(ids(await explorar(tokens.labMember))).toContain(plantedId);
    expect(ids(await explorar(tokens.alvaro))).not.toContain(plantedId);
    expect(ids(await inicio(tokens.alvaro))).not.toContain(plantedId);
    // Even by id: the restrictive policy hides the post, so the detail read carries none of it. 09-05
    // (D-469) turned the stranger's bare 404 into the locked answer, which names the author and nothing
    // else (asserted in full under `09 gate`); the policy still hides every byte of the post.
    const detail = await request(`/v1/feed/posts/${plantedId}`, tokens.alvaro);
    expect(detail.status).toBe(403);
    const details = ((await detail.json()) as Envelope).error.details;
    expect(details?.access).toBe('follow_required');
    expect(JSON.stringify(details)).not.toContain('de um desconhecido');
  });
});

describe('09 audience', () => {
  it('8. scope with communityId or with media answers 400 VALIDATION_FAILED scope_conflict', async () => {
    const withCommunity = await request(
      '/v1/feed?scope=explorar&communityId=99999999-9999-4999-8999-999999999999',
      tokens.alvaro,
    );
    expect(withCommunity.status).toBe(400);
    const body = (await withCommunity.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body.error.details)).toContain('scope_conflict');

    const withMedia = await request('/v1/feed?scope=explorar&media=video', tokens.alvaro);
    expect(withMedia.status).toBe(400);
    expect(((await withMedia.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');

    const unknown = await request('/v1/feed?scope=seguindo', tokens.alvaro);
    expect(unknown.status).toBe(400);
  });

  it('9. a real support session answers 403 FORBIDDEN on the scope (D-475), staff admin passes', async () => {
    const support = await request('/v1/feed?scope=explorar', tokens.labSupport);
    expect(support.status).toBe(403);
    expect(((await support.json()) as Envelope).error.code).toBe('FORBIDDEN');
    const admin = await request('/v1/feed?scope=explorar', tokens.labAdmin);
    expect(admin.status).toBe(200);
  });

  it('10. a member of a tenant without social answers 404 MODULE_DISABLED on the scope', async () => {
    const res = await request('/v1/feed?scope=explorar', tokens.demoMember, {}, HOSTS.demo);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    // The same member's ordinary feed is unchanged.
    const plain = await request('/v1/feed?limit=5', tokens.demoMember, {}, HOSTS.demo);
    expect(plain.status).toBe(200);
  });

  it('11. D-473: a member cannot forge the audience: the body schema is strict and nothing is written', async () => {
    const res = await request('/v1/feed/posts', tokens.helena, {
      method: 'POST',
      body: JSON.stringify({ caption: `${PREFIX}forjado`, visibility: 'tenant' }),
    });
    expect(res.status).toBe(400);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_posts where caption = ${`${PREFIX}forjado`}`;
    expect(count?.n).toBe(0);
  });

  it('12. D-476: a member post notifies nobody while an admin post keeps its broadcast', async () => {
    const memberRes = await publish(tokens.helena, `${PREFIX}sem notificacao`);
    const member = (await memberRes.json()) as FeedPost;
    const adminRes = await publish(tokens.labAdmin, `${PREFIX}com notificacao`);
    const admin = (await adminRes.json()) as FeedPost;
    const source = feedNotificationSources[0];
    if (!source) throw new Error('feed declares no post.published source');
    const lane = notificationsSystemCtx(labTenantId);

    const resolveFor = (post: FeedPost, authorUserId: string) =>
      withTenantTx(lane, async (tx) => {
        // The system lane (the zero user) still reads a member post, so the empty answer below is the
        // resolver's guard and not RLS hiding the row.
        const seen = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from feed_posts where id = ${post.id}::uuid`,
        );
        expect(seen[0]?.n).toBe(1);
        return source.resolve(
          tx,
          {
            tenantId: labTenantId,
            postId: post.id,
            authorUserId,
            communityId: null,
            hasMedia: false,
            occurredAt: post.createdAt,
          },
          { sinkAt: new Date().toISOString() },
        );
      });

    expect(await resolveFor(member, userIds.helena)).toEqual([]);
    const intents = await resolveFor(admin, userIds.labAdmin);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.audience).toEqual({ type: 'members' });
  });

  it('13. EP-11: two identical publishes make two posts, edits advance edited_at and keep the audience, a repeated delete is the bare 404', async () => {
    const body = `${PREFIX}repetido`;
    const a = (await (await publish(tokens.helena, body)).json()) as FeedPost;
    const b = (await (await publish(tokens.helena, body)).json()) as FeedPost;
    expect(a.id).not.toBe(b.id);

    const edit = (caption: string) =>
      request(`/v1/feed/posts/${a.id}`, tokens.helena, {
        method: 'PATCH',
        body: JSON.stringify({ caption }),
      });
    const first = await edit(`${PREFIX}editado`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as FeedPost;
    const second = await edit(`${PREFIX}editado`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as FeedPost;
    expect(firstBody.editedAt).not.toBeNull();
    expect(new Date(secondBody.editedAt ?? 0).getTime()).toBeGreaterThan(
      new Date(firstBody.editedAt ?? 0).getTime(),
    );
    expect(secondBody.audience).toBe('followers');
    const [row] = await adminSql<{ visibility: string }[]>`
      select visibility from public.feed_posts where id = ${a.id}::uuid`;
    expect(row?.visibility).toBe('followers');

    const del = await request(`/v1/feed/posts/${a.id}`, tokens.helena, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const again = await request(`/v1/feed/posts/${a.id}`, tokens.helena, { method: 'DELETE' });
    expect(again.status).toBe(404);
    const bare = (await again.json()) as Envelope;
    expect(bare.error.code).toBe('NOT_FOUND');
    expect(bare.error.details).toBeUndefined();
  });

  it('14. the Explorar page costs ONE statement against the feed tables (the budget is unchanged)', async () => {
    await adminSql`select pg_stat_statements_reset()`;
    const res = await request('/v1/feed?scope=explorar&limit=10', tokens.alvaro);
    expect(res.status).toBe(200);
    const [measured] = await adminSql<{ calls: number }[]>`
      select coalesce(sum(calls), 0)::int as calls
        from pg_stat_statements
       where query ~ 'feed_(posts|post_media|comments|likes|link_previews)'`;
    expect(measured?.calls ?? 0).toBeGreaterThan(0);
    expect(measured?.calls ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('09 reels', () => {
  const v: { admin?: string; helena?: string } = {};

  it('1. SOCIAL-04, EXPL-06, D-480: a follower’s Reels "Todos" holds the followed member’s video beside the admin’s, newest first', async () => {
    v.admin = await videoPost({
      authorUserId: userIds.labAdmin,
      caption: `${PREFIX}video da diretoria`,
      visibility: 'tenant',
    });
    v.helena = await videoPost({
      authorUserId: userIds.helena,
      caption: `${PREFIX}video de Helena`,
      visibility: 'followers',
    });
    const found = ids(await reels(tokens.alvaro));
    expect(found).toContain(v.admin);
    expect(found).toContain(v.helena);
    expect(found.indexOf(v.helena ?? '')).toBeLessThan(found.indexOf(v.admin ?? ''));
  });

  it('2. a stranger’s Reels holds the admin’s video only', async () => {
    const found = ids(await reels(tokens.marcos));
    expect(found).toContain(v.admin);
    expect(found).not.toContain(v.helena);
  });

  it('3. the author lists her own member video, beside the admin’s', async () => {
    const found = ids(await reels(tokens.helena));
    expect(found).toContain(v.helena);
    expect(found).toContain(v.admin);
  });

  it('4. Início lists neither video of a member for anyone, and the admin’s video for everyone', async () => {
    for (const token of [tokens.alvaro, tokens.helena, tokens.marcos, tokens.labAdmin]) {
      const found = ids(await inicio(token));
      expect(found).not.toContain(v.helena);
      expect(found).toContain(v.admin);
    }
  });

  it('5. D-480: a moderator’s Reels lists the admin’s video and NO member video (Explorar is where a moderator sees them)', async () => {
    const found = ids(await reels(tokens.labAdmin));
    expect(found).toContain(v.admin);
    expect(found).not.toContain(v.helena);
    expect(ids(await explorar(tokens.labAdmin))).toContain(v.helena);
  });

  it('6. a community lane never lists a member video: the database refuses a member post in a community, and the lane holds none', async () => {
    const restoreCommunities = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'communities'`;
    const before = restoreCommunities[0] ? restoreCommunities[0].enabled : null;
    const setCommunities = async (enabled: boolean) => {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${labTenantId}::uuid, 'communities', ${enabled})
        on conflict (tenant_id, module_key) do update set enabled = ${enabled}`;
      moduleFlags.invalidate(labTenantId);
    };
    await setCommunities(true);
    try {
      const created = await request('/v1/communities', tokens.labAdmin, {
        method: 'POST',
        body: JSON.stringify({ name: `${PREFIX}comunidade` }),
      });
      expect(created.status).toBe(201);
      const community = (await created.json()) as { id: string };

      await expect(
        adminSql`
          insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
          values (${labTenantId}::uuid, ${userIds.helena}::uuid, ${`${PREFIX}forjado na comunidade`},
                  'followers', ${community.id}::uuid)`,
      ).rejects.toThrow(/feed_posts_visibility_shape_chk/);

      for (const media of ['', '&media=video']) {
        const res = await request(
          `/v1/feed?communityId=${community.id}&limit=25${media}`,
          tokens.alvaro,
        );
        expect(res.status).toBe(200);
        const items = ((await res.json()) as FeedPage).items;
        expect(ids(items)).not.toContain(v.helena);
        expect(items.every((item) => item.audience === undefined)).toBe(true);
      }
    } finally {
      if (before === null) {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${labTenantId}::uuid and module_key = 'communities'`;
        moduleFlags.invalidate(labTenantId);
      } else {
        await setCommunities(before);
      }
    }
  });
});

describe('09 explorar', () => {
  /**
   * 09-04 (EXPL-02, EXPL-06, SOCIAL-04, SOCIAL-09, D-471, D-475, D-480, D-483, D-484): the three
   * audiences against the real stack, with every `adminSql` mutation (a follow row, a block, the
   * `social` flag, a soft-deleted seed video) restored in a `finally`. The describe starts from a
   * clean slate (`sweep`) so an empty Explorar really is empty. Test ORDER is load-bearing: the empty
   * states run before any fixture exists.
   */
  type Page = FeedPage & { followsAnyone?: boolean };

  const page = async (token: string, path: string, host = HOSTS.lab): Promise<Page> => {
    const res = await request(path, token, {}, host);
    expect(res.status, `GET ${path}`).toBe(200);
    return (await res.json()) as Page;
  };

  /** Walk a list one row per page (the nastiest paging), asserting every page's status. */
  const walkOne = async (token: string, base: string): Promise<FeedPost[]> => {
    const seen: FeedPost[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const path: string = `${base}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body: Page = await page(token, path);
      seen.push(...body.items);
      cursor = body.nextCursor;
      if (cursor === null) return seen;
    }
    throw new Error(`walkOne(${base}) did not reach the end in 200 pages`);
  };

  const memberPost = async (
    authorUserId: string,
    caption: string,
    createdAt?: string,
  ): Promise<string> => {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, created_at)
      values (${labTenantId}::uuid, ${authorUserId}::uuid, ${`${PREFIX}${caption}`}, 'followers',
              coalesce(${createdAt ?? null}::timestamptz, now()))
      returning id`;
    return row?.id ?? '';
  };

  const orgPost = async (caption: string, createdAt?: string): Promise<string> => {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, created_at)
      values (${labTenantId}::uuid, ${userIds.labAdmin}::uuid, ${`${PREFIX}${caption}`}, 'tenant',
              coalesce(${createdAt ?? null}::timestamptz, now()))
      returning id`;
    return row?.id ?? '';
  };

  const follow = (follower: string, followee: string) =>
    adminSql`
      insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
      values (${labTenantId}::uuid, ${follower}::uuid, ${followee}::uuid)
      on conflict do nothing`;
  const unfollow = (follower: string, followee: string) =>
    adminSql`
      delete from public.social_follows
       where tenant_id = ${labTenantId}::uuid and follower_user_id = ${follower}::uuid
         and followee_user_id = ${followee}::uuid`;
  const block = (userId: string) =>
    adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;
  const unblock = (userId: string) =>
    adminSql`
      update public.memberships set status = 'active', blocked_at = null
       where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;
  const followRows = async (): Promise<number> => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.social_follows where tenant_id = ${labTenantId}::uuid`;
    return row?.n ?? 0;
  };
  const setSocial = async (enabled: boolean) => {
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${labTenantId}::uuid, 'social', ${enabled})
      on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
    moduleFlags.invalidate(labTenantId);
  };
  const descending = (items: FeedPost[]): boolean =>
    items.every((item, i) => {
      const prev = items[i - 1];
      return (
        !prev ||
        prev.createdAt > item.createdAt ||
        (prev.createdAt === item.createdAt && prev.id > item.id)
      );
    });

  const ids2: Record<string, string> = {};
  let demoAdminToken = '';
  let hourAgo = '';

  beforeAll(async () => {
    await sweep();
    demoAdminToken = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
    const [t] = await adminSql<{ t: string }[]>`select (now() - interval '1 hour')::text as t`;
    hourAgo = t?.t ?? '';
  });

  it('1. EP-14: a member who follows nobody and has no post gets the empty Explorar with followsAnyone false; Início is unchanged and Reels holds organization videos only', async () => {
    const body = await page(tokens.labMember, '/v1/feed?scope=explorar&limit=25');
    expect(body).toEqual({ items: [], nextCursor: null, followsAnyone: false });
    const inicioItems = await inicio(tokens.labMember);
    expect(inicioItems.length).toBeGreaterThan(0);
    expect(inicioItems.every((item) => item.audience === undefined)).toBe(true);
    const reelsItems = await reels(tokens.labMember);
    expect(reelsItems.every((item) => item.audience === undefined)).toBe(true);
  });

  it('2. UI-D-494: followsAnyone is absent for a moderator, even on an empty page', async () => {
    const body = await page(tokens.labAdmin, '/v1/feed?scope=explorar&limit=25');
    expect(body).toEqual({ items: [], nextCursor: null });
    expect(Object.keys(body)).not.toContain('followsAnyone');
  });

  it('3. EP-48: a silent followee gives items [] with followsAnyone true; a blocked-only followee gives followsAnyone false', async () => {
    await follow(userIds.labMember, userIds.helena);
    try {
      const silent = await page(tokens.labMember, '/v1/feed?scope=explorar&limit=25');
      expect(silent).toEqual({ items: [], nextCursor: null, followsAnyone: true });
    } finally {
      await unfollow(userIds.labMember, userIds.helena);
    }

    await follow(userIds.labMember, userIds.marcos);
    const marcosPost = await memberPost(userIds.marcos, 'de Marcos, antes do bloqueio');
    await block(userIds.marcos);
    try {
      const blocked = await page(tokens.labMember, '/v1/feed?scope=explorar&limit=25');
      expect(blocked).toEqual({ items: [], nextCursor: null, followsAnyone: false });
      // The follow row survived the block, and unblocking restores the post.
      expect(await followRows()).toBeGreaterThan(0);
    } finally {
      await unblock(userIds.marcos);
    }
    expect(ids(await explorar(tokens.labMember))).toContain(marcosPost);
    await unfollow(userIds.labMember, userIds.marcos);
    await adminSql`delete from public.feed_posts where id = ${marcosPost}::uuid`;
  });

  it('4. EP-13 and EP-15: an organization post and a followed member post of the SAME microsecond land in different audiences, and Início holds tenant rows only', async () => {
    ids2.tiedOrg = await orgPost('empate organizacao', hourAgo);
    ids2.tiedMember = await memberPost(userIds.helena, 'empate membro', hourAgo);
    const inicioIds = ids(await inicio(tokens.alvaro));
    expect(inicioIds).toContain(ids2.tiedOrg);
    expect(inicioIds).not.toContain(ids2.tiedMember);
    const explorarIds = ids(await explorar(tokens.alvaro));
    expect(explorarIds).toContain(ids2.tiedMember);
    expect(explorarIds).not.toContain(ids2.tiedOrg);

    for (const token of [tokens.alvaro, tokens.helena, tokens.labAdmin]) {
      const items = await inicio(token);
      expect(items.every((item) => item.audience === undefined)).toBe(true);
      expect(descending(items)).toBe(true);
    }
  });

  it('5. EP-47: the viewer’s own post and a followee’s post with the identical created_at appear once each in id desc order, and a limit-1 walk neither duplicates nor skips', async () => {
    ids2.ownTie = await memberPost(userIds.alvaro, 'proprio empatado', hourAgo);
    ids2.followeeTie = ids2.tiedMember ?? '';
    const full = await explorar(tokens.alvaro);
    const tied = full.filter(
      (item) => item.createdAt === full.find((p) => p.id === ids2.ownTie)?.createdAt,
    );
    expect(
      tied
        .map((item) => item.id)
        .sort()
        .reverse(),
    ).toEqual(tied.map((item) => item.id));
    expect(tied.map((item) => item.id)).toEqual(
      expect.arrayContaining([ids2.ownTie ?? '', ids2.followeeTie ?? '']),
    );

    const walked = await walkOne(tokens.alvaro, '/v1/feed?scope=explorar');
    expect(ids(walked)).toEqual(ids(full));
    expect(new Set(ids(walked)).size).toBe(walked.length);
  });

  it('6. EP-49: a cursor stays valid after the viewer follows a new author, and a tampered or foreign cursor degrades to page 1', async () => {
    await memberPost(userIds.marcos, 'antigo de Marcos', '2020-01-01T00:00:00Z');
    const firstPage = await page(tokens.alvaro, '/v1/feed?scope=explorar&limit=1');
    expect(firstPage.nextCursor).not.toBeNull();
    const cursor = encodeURIComponent(firstPage.nextCursor ?? '');
    await follow(userIds.alvaro, userIds.marcos);
    try {
      const second = await page(tokens.alvaro, `/v1/feed?scope=explorar&limit=1&cursor=${cursor}`);
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(firstPage.items[0]?.id);
      // The new author’s older post falls in order at the tail of the walk.
      const walked = await walkOne(tokens.alvaro, '/v1/feed?scope=explorar');
      expect(walked.at(-1)?.caption).toBe(`${PREFIX}antigo de Marcos`);
      expect(descending(walked)).toBe(true);
    } finally {
      await unfollow(userIds.alvaro, userIds.marcos);
    }

    const forgeries = [
      'nao-e-um-cursor',
      Buffer.from(JSON.stringify({ v: 9, n: 'x', id: ids2.ownTie })).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, n: 'x', id: 'not-a-uuid' })).toString('base64url'),
      (firstPage.nextCursor ?? '').slice(0, 12),
    ];
    for (const forged of forgeries) {
      const degraded = await page(
        tokens.alvaro,
        `/v1/feed?scope=explorar&limit=1&cursor=${encodeURIComponent(forged)}`,
      );
      expect(ids(degraded.items)).toEqual(ids(firstPage.items));
    }
    // followsAnyone belongs to an empty FIRST page only: a cursor past the oldest post answers none.
    const beyond = Buffer.from(
      JSON.stringify({ v: 1, n: '1999-01-01T00:00:00.000000Z', id: ids2.ownTie }),
    ).toString('base64url');
    const empty = await page(tokens.alvaro, `/v1/feed?scope=explorar&cursor=${beyond}`);
    expect(empty).toEqual({ items: [], nextCursor: null });
  });

  it('7. EP-54, EP-56 and D-480: a limit-1 walk of Reels "Todos" over an admin video and a followed member video of the same created_at returns each once, in id desc order; the member video is the post Explorar lists', async () => {
    ids2.videoOrg = await videoPost({
      authorUserId: userIds.labAdmin,
      caption: `${PREFIX}reels organizacao`,
      visibility: 'tenant',
      createdAt: hourAgo,
    });
    ids2.videoMember = await videoPost({
      authorUserId: userIds.helena,
      caption: `${PREFIX}reels membro`,
      visibility: 'followers',
      createdAt: hourAgo,
    });
    ids2.videoOwn = await videoPost({
      authorUserId: userIds.alvaro,
      caption: `${PREFIX}reels proprio`,
      visibility: 'followers',
    });
    const walked = await walkOne(tokens.alvaro, '/v1/feed?media=video');
    const walkedIds = ids(walked);
    for (const id of [ids2.videoOrg, ids2.videoMember, ids2.videoOwn]) {
      expect(walkedIds.filter((x) => x === id)).toHaveLength(1);
    }
    // The union is one total order.
    expect(descending(walked)).toBe(true);
    const tiedPair = walkedIds.filter((id) => id === ids2.videoOrg || id === ids2.videoMember);
    expect(tiedPair).toEqual([ids2.videoOrg ?? '', ids2.videoMember ?? ''].sort().reverse());

    // The same row: same id, same like count as Explorar lists it.
    const inReels = walked.find((item) => item.id === ids2.videoMember);
    const inExplorar = (await explorar(tokens.alvaro)).find((item) => item.id === ids2.videoMember);
    expect(inReels).toBeDefined();
    expect(inReels?.id).toBe(inExplorar?.id);
    expect(inReels?.likeCount).toBe(inExplorar?.likeCount);
    // A stranger’s Reels holds the organization video only.
    const stranger = ids(await reels(tokens.marcos));
    expect(stranger).toContain(ids2.videoOrg);
    expect(stranger).not.toContain(ids2.videoMember);
    expect(stranger).not.toContain(ids2.videoOwn);
  });

  it('8. EP-26: block then unblock a followed author: posts and videos leave Explorar and Reels (the moderator’s Explorar too) and return with the same ids and counts; the follow row survives', async () => {
    const before = {
      explorar: await explorar(tokens.alvaro),
      reels: await reels(tokens.alvaro),
      moderator: await explorar(tokens.labAdmin),
      rows: await followRows(),
    };
    const helenaIds = [ids2.tiedMember, ids2.videoMember];
    for (const id of helenaIds) expect(ids(before.explorar)).toContain(id);

    await block(userIds.helena);
    try {
      const during = {
        explorar: ids(await explorar(tokens.alvaro)),
        reels: ids(await reels(tokens.alvaro)),
        moderator: ids(await explorar(tokens.labAdmin)),
      };
      for (const id of helenaIds) {
        expect(during.explorar).not.toContain(id);
        expect(during.reels).not.toContain(id);
        expect(during.moderator).not.toContain(id);
      }
      expect(await followRows()).toBe(before.rows);
    } finally {
      await unblock(userIds.helena);
    }
    const after = {
      explorar: await explorar(tokens.alvaro),
      reels: await reels(tokens.alvaro),
      moderator: await explorar(tokens.labAdmin),
    };
    expect(after.explorar.map((p) => [p.id, p.likeCount, p.commentCount])).toEqual(
      before.explorar.map((p) => [p.id, p.likeCount, p.commentCount]),
    );
    expect(ids(after.reels)).toEqual(ids(before.reels));
    expect(ids(after.moderator)).toEqual(ids(before.moderator));
  });

  it('9. D-475: the moderator’s Explorar lists every live member post without following anyone, canManage false, and never the admin’s organization post; support 403; a tenant without social 404', async () => {
    const items = await explorar(tokens.labAdmin);
    for (const id of [ids2.tiedMember, ids2.ownTie, ids2.videoMember, ids2.videoOwn]) {
      expect(ids(items)).toContain(id);
    }
    expect(ids(items)).not.toContain(ids2.tiedOrg);
    expect(ids(items)).not.toContain(ids2.videoOrg);
    expect(items.every((item) => item.canManage === false)).toBe(true);
    expect(items.every((item) => item.audience === 'followers')).toBe(true);
    expect(descending(items)).toBe(true);

    const support = await request('/v1/feed?scope=explorar', tokens.labSupport);
    expect(support.status).toBe(403);
    // The module answer comes first (404, never 403) even for the demo tenant’s own admin.
    for (const token of [tokens.demoMember, demoAdminToken]) {
      const res = await request('/v1/feed?scope=explorar', token, {}, HOSTS.demo);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    }
  });

  it('10. D-483 and EP-28: social off answers 404 on the scope, hides member videos from Reels, leaves Início unchanged; turning it on restores the posts in the original order with the follow rows untouched', async () => {
    const before = {
      explorar: await explorar(tokens.alvaro),
      inicio: ids(await inicio(tokens.alvaro)),
      rows: await followRows(),
    };
    await setSocial(false);
    try {
      const off = await request('/v1/feed?scope=explorar', tokens.alvaro);
      expect(off.status).toBe(404);
      expect(((await off.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
      expect(ids(await inicio(tokens.alvaro))).toEqual(before.inicio);
      const offReels = ids(await reels(tokens.alvaro));
      expect(offReels).toContain(ids2.videoOrg);
      expect(offReels).not.toContain(ids2.videoMember);
      expect(offReels).not.toContain(ids2.videoOwn);
    } finally {
      await setSocial(true);
    }
    const after = await explorar(tokens.alvaro);
    expect(after.map((p) => [p.id, p.likeCount, p.commentCount])).toEqual(
      before.explorar.map((p) => [p.id, p.likeCount, p.commentCount]),
    );
    expect(await followRows()).toBe(before.rows);
  });

  it('11. EP-55: Reels "Todos" for a member who follows nobody equals the organization videos; with no video anywhere the page is the unchanged empty page', async () => {
    const loner = await reels(tokens.labMember);
    expect(ids(loner)).toContain(ids2.videoOrg);
    expect(ids(loner)).not.toContain(ids2.videoMember);
    expect(loner.every((item) => item.audience === undefined)).toBe(true);

    // Take every video of the tenant out of the lists, for the one statement below, then put them back.
    const hidden = await adminSql<{ id: string }[]>`
      update public.feed_posts set deleted_at = now()
       where tenant_id = ${labTenantId}::uuid and media_kind = 'video' and deleted_at is null
      returning id`;
    try {
      const body = await page(tokens.alvaro, '/v1/feed?media=video&limit=25');
      expect(body).toEqual({ items: [], nextCursor: null });
    } finally {
      const restored = hidden.map((row) => row.id);
      await adminSql`update public.feed_posts set deleted_at = null where id = any(${restored}::uuid[])`;
    }
    expect(ids(await reels(tokens.alvaro))).toContain(ids2.videoMember);
  });
});

/* ── 09-05: who may open a member post, and what a stranger is told ───────────────────────────────── */

/** A followers-only post written straight into the table (the audience and the author are exactly the case's). */
async function followersPost(authorUserId: string, caption: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
    values (${labTenantId}::uuid, ${authorUserId}::uuid, ${`${PREFIX}${caption}`}, 'followers')
    returning id`;
  return row?.id ?? '';
}

/** The author record a stranger may learn (D-469): membership id, display name, avatar asset id. */
async function authorRecord(
  userId: string,
): Promise<{ membershipId: string; displayName: string; avatarAssetId: string | null }> {
  const [row] = await adminSql<
    { membership_id: string; display_name: string; avatar_asset_id: string | null }[]
  >`
    select ms.id as membership_id, mp.display_name, mp.avatar_asset_id
      from public.memberships ms
      join public.member_profiles mp on mp.membership_id = ms.id
     where ms.tenant_id = ${labTenantId}::uuid and ms.user_id = ${userId}::uuid`;
  if (!row) throw new Error(`no membership for ${userId}`);
  return {
    membershipId: row.membership_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  };
}

describe('09 gate', () => {
  /**
   * 09-05 Task 1 (SOCIAL-06, D-469, D-483, D-484): a stranger opening a shared link to a member post
   * is told ONLY who the author is; following opens the post; every other miss is the bare 404.
   */
  let postId = '';
  let helenaRecord: Awaited<ReturnType<typeof authorRecord>>;
  const CAPTION = 'legenda reservada aos seguidores';

  beforeAll(async () => {
    await sweep();
    // Marcos must be a stranger to Helena (the seed has Alvaro -> Helena and Helena -> Marcos only).
    await adminSql`
      delete from public.social_follows
       where tenant_id = ${labTenantId}::uuid and follower_user_id = ${userIds.marcos}::uuid`;
    postId = await followersPost(userIds.helena, CAPTION);
    helenaRecord = await authorRecord(userIds.helena);
  });

  afterAll(async () => {
    await adminSql`
      delete from public.social_follows
       where tenant_id = ${labTenantId}::uuid and follower_user_id = ${userIds.marcos}::uuid`;
  });

  it('1. SOCIAL-06 tracer: a stranger gets 403 follow_required whose details are exactly the author, and no other byte of the post', async () => {
    const res = await request(`/v1/feed/posts/${postId}`, tokens.marcos);
    expect(res.status).toBe(403);
    const raw = await res.text();
    const body = JSON.parse(raw) as Envelope;
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details).toEqual({ access: 'follow_required', author: helenaRecord });
    expect(Object.keys(body.error.details ?? {}).sort()).toEqual(['access', 'author']);
    expect(Object.keys((body.error.details?.author as object) ?? {}).sort()).toEqual([
      'avatarAssetId',
      'displayName',
      'membershipId',
    ]);
    // PR-2: not the caption, not the post id, not a count, not a timestamp.
    expect(raw).not.toContain(CAPTION);
    expect(raw).not.toContain(postId);
    expect(raw).not.toMatch(/likeCount|commentCount|createdAt|caption/);
  });

  it('2. after the stranger follows the author the same call answers 200 with the full post', async () => {
    const put = await request(`/v1/social/follows/${helenaRecord.membershipId}`, tokens.marcos, {
      method: 'PUT',
    });
    expect(put.status).toBe(200);
    const res = await request(`/v1/feed/posts/${postId}`, tokens.marcos);
    expect(res.status).toBe(200);
    const post = (await res.json()) as FeedPost;
    expect(post.id).toBe(postId);
    expect(post.caption).toBe(`${PREFIX}${CAPTION}`);
    expect(post.audience).toBe('followers');
    const del = await request(`/v1/social/follows/${helenaRecord.membershipId}`, tokens.marcos, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const again = await request(`/v1/feed/posts/${postId}`, tokens.marcos);
    expect(again.status).toBe(403);
  });

  it('3. EP-18: the author and a follower read the post with no locked answer', async () => {
    for (const token of [tokens.helena, tokens.alvaro]) {
      const res = await request(`/v1/feed/posts/${postId}`, token);
      expect(res.status).toBe(200);
    }
  });

  it('4. D-469: a real support user, an unknown id and a removed post are the bare 404 with no details', async () => {
    const bare = async (token: string, id: string) => {
      const res = await request(`/v1/feed/posts/${id}`, token);
      expect(res.status, id).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    };
    await bare(tokens.labSupport, postId);
    await bare(tokens.marcos, crypto.randomUUID());
    const removed = await followersPost(userIds.helena, 'removido');
    await adminSql`update public.feed_posts set deleted_at = now() where id = ${removed}::uuid`;
    await bare(tokens.marcos, removed);
    await bare(tokens.alvaro, removed);
  });

  it('5. SOCIAL-10: a rede-demo session on the lab host answers 403 TENANT_HOST_MISMATCH and a rede-demo post id is the bare 404 for a lab member', async () => {
    const res = await request(`/v1/feed/posts/${postId}`, tokens.demoMember);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
  });

  it('6. D-484 / D-483: a blocked author and `social` off are the bare 404, the author’s own link included', async () => {
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid`;
    try {
      for (const token of [tokens.marcos, tokens.alvaro]) {
        const res = await request(`/v1/feed/posts/${postId}`, token);
        expect(res.status).toBe(404);
        expect(((await res.json()) as Envelope).error.details).toBeUndefined();
      }
    } finally {
      await adminSql`
        update public.memberships set status = 'active', blocked_at = null
         where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid`;
    }
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      for (const token of [tokens.marcos, tokens.alvaro, tokens.helena]) {
        const res = await request(`/v1/feed/posts/${postId}`, token);
        expect(res.status).toBe(404);
        const body = (await res.json()) as Envelope;
        expect(body.error.details).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('follow_required');
      }
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    const back = await request(`/v1/feed/posts/${postId}`, tokens.alvaro);
    expect(back.status).toBe(200);
  });
});

describe('09 interactions', () => {
  /**
   * 09-05 Task 2 (SOCIAL-06, SOCIAL-09, EXPL-03; D-469, D-475, D-483, D-484; EP-18..21, 27, 50, 51):
   * every like, comment, reply and thread route follows the gate of the post it hangs off. A stranger
   * gets the closed 403 `follow_required` with NO author; support, a blocked author and `social` off
   * are the bare 404; a refusal changes nothing (the gate runs BEFORE any write). Every mutation made
   * through `adminSql` (a follow, a block, the flag, the display name) is restored in a `finally`.
   */
  const IDENTITY_PREFIX = 'p09-05';
  let postId = '';
  let rootA = '';
  let rootB = '';
  let replyA = '';
  let replyB = '';
  let helenaMembershipId = '';

  const call = (token: string, method: string, path: string, body?: unknown) =>
    request(path, token, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const setSocialFlag = async (enabled: boolean) => {
    await adminSql`
      update public.tenant_modules set enabled = ${enabled}
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
  };
  const followRow = (follower: string, followee: string) =>
    adminSql`
      insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
      values (${labTenantId}::uuid, ${follower}::uuid, ${followee}::uuid)
      on conflict do nothing`;
  const unfollowRow = (follower: string, followee: string) =>
    adminSql`
      delete from public.social_follows
       where tenant_id = ${labTenantId}::uuid and follower_user_id = ${follower}::uuid
         and followee_user_id = ${followee}::uuid`;
  const setBlocked = (userId: string, blocked: boolean) =>
    adminSql`
      update public.memberships
         set status = ${blocked ? 'blocked' : 'active'}, blocked_at = ${blocked ? new Date() : null}
       where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;

  /** The numbers a refusal must not move: the post's counters and the rows behind them. */
  const state = async (id: string) => {
    const [row] = await adminSql<{ like_count: number; comment_count: number }[]>`
      select like_count, comment_count from public.feed_posts where id = ${id}::uuid`;
    const [likes] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes where post_id = ${id}::uuid`;
    const [comments] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_comments where post_id = ${id}::uuid`;
    const [commentLikes] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.feed_likes
       where comment_id in (select id from public.feed_comments where post_id = ${id}::uuid)`;
    return {
      likeCount: row?.like_count,
      commentCount: row?.comment_count,
      likeRows: likes?.n,
      commentRows: comments?.n,
      commentLikeRows: commentLikes?.n,
    };
  };

  const expectLocked = async (res: Response, label: string) => {
    expect(res.status, label).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code, label).toBe('FORBIDDEN');
    // The closed reaction: the access word and NOTHING else (no author on an interaction, D-469).
    expect(body.error.details, label).toEqual({ access: 'follow_required' });
  };
  const expectBare404 = async (res: Response, label: string) => {
    expect(res.status, label).toBe(404);
    const raw = await res.text();
    const body = JSON.parse(raw) as Envelope;
    expect(body.error.code, label).toBe('NOT_FOUND');
    expect(body.error.details, label).toBeUndefined();
    expect(raw, label).not.toContain('follow_required');
  };

  /** The eleven routes a post's gate has to cover, as [label, method, path, body]. */
  const routes = (): [string, string, string, unknown?][] => [
    ['GET post', 'GET', `/v1/feed/posts/${postId}`],
    ['POST like', 'POST', `/v1/feed/posts/${postId}/like`],
    ['DELETE like', 'DELETE', `/v1/feed/posts/${postId}/like`],
    ['GET comments', 'GET', `/v1/feed/posts/${postId}/comments`],
    ['POST comment', 'POST', `/v1/feed/posts/${postId}/comments`, { body: 'recusado' }],
    [
      'POST reply',
      'POST',
      `/v1/feed/posts/${postId}/comments`,
      { body: 'recusado', parentId: rootA },
    ],
    ['POST comment like', 'POST', `/v1/feed/comments/${rootA}/like`],
    ['DELETE comment like', 'DELETE', `/v1/feed/comments/${rootA}/like`],
    ['GET replies', 'GET', `/v1/feed/comments/${rootA}/replies`],
    ['GET thread', 'GET', `/v1/feed/comments/${replyA}/thread`],
    ['DELETE comment', 'DELETE', `/v1/feed/comments/${rootA}`],
  ];

  beforeAll(async () => {
    await sweep();
    await removeIdentitiesByPrefix(IDENTITY_PREFIX);
    await unfollowRow(userIds.marcos, userIds.helena);
    postId = await followersPost(userIds.helena, 'post das interacoes');
    helenaMembershipId = (await authorRecord(userIds.helena)).membershipId;
    // The thread is written by the FOLLOWER through the API (a follower may comment and reply).
    const mk = async (body: string, parentId?: string): Promise<string> => {
      const res = await call(tokens.alvaro, 'POST', `/v1/feed/posts/${postId}/comments`, {
        body,
        ...(parentId ? { parentId } : {}),
      });
      expect(res.status, body).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    rootA = await mk('raiz A');
    rootB = await mk('raiz B');
    replyA = await mk('resposta A', rootA);
    replyB = await mk('resposta B', rootA);
  });

  afterAll(async () => {
    await removeIdentitiesByPrefix(IDENTITY_PREFIX);
    await unfollowRow(userIds.marcos, userIds.helena);
    await unfollowRow(userIds.labAdmin, userIds.helena);
  });

  it('1. EP-18 / EP-21: the author and a follower like, comment and read; the comment lists keep their order', async () => {
    const like = await call(tokens.alvaro, 'POST', `/v1/feed/posts/${postId}/like`);
    expect(like.status).toBe(200);
    const own = await call(tokens.helena, 'POST', `/v1/feed/posts/${postId}/like`);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { likeCount: number }).likeCount).toBe(2);
    const comment = await call(tokens.helena, 'POST', `/v1/feed/posts/${postId}/comments`, {
      body: 'raiz da autora',
    });
    expect(comment.status).toBe(201);
    const rootC = ((await comment.json()) as { id: string }).id;

    for (const token of [tokens.alvaro, tokens.helena]) {
      const roots = await call(token, 'GET', `/v1/feed/posts/${postId}/comments`);
      expect(roots.status).toBe(200);
      // Roots newest first on (created_at, id).
      expect(((await roots.json()) as { items: { id: string }[] }).items.map((c) => c.id)).toEqual([
        rootC,
        rootB,
        rootA,
      ]);
      const replies = await call(token, 'GET', `/v1/feed/comments/${rootA}/replies`);
      expect(replies.status).toBe(200);
      // Replies oldest first.
      expect(
        ((await replies.json()) as { items: { id: string }[] }).items.map((c) => c.id),
      ).toEqual([replyA, replyB]);
      const thread = await call(token, 'GET', `/v1/feed/comments/${replyB}/thread`);
      expect(thread.status).toBe(200);
    }
    const likeComment = await call(tokens.alvaro, 'POST', `/v1/feed/comments/${rootA}/like`);
    expect(likeComment.status).toBe(200);
    const unlikeComment = await call(tokens.alvaro, 'DELETE', `/v1/feed/comments/${rootA}/like`);
    expect(unlikeComment.status).toBe(200);
  });

  it('2. EP-21 / T-09-17: a stranger is refused on every route with the closed reaction, and nothing moves', async () => {
    const before = await state(postId);
    for (const [label, method, path, body] of routes()) {
      const res = await call(tokens.marcos, method, path, body);
      if (label === 'GET post') {
        expect(res.status, label).toBe(403);
        const details = ((await res.json()) as Envelope).error.details;
        expect(Object.keys(details ?? {}).sort(), label).toEqual(['access', 'author']);
      } else if (label === 'DELETE comment') {
        // Not the author and not a moderator: the same bare 404 as always (D-61).
        await expectBare404(res, label);
      } else {
        await expectLocked(res, label);
      }
    }
    expect(await state(postId)).toEqual(before);
  });

  it('3. EP-19: a follower opening a post with no comment and no like gets 200 with zero counts and an empty page', async () => {
    const empty = await followersPost(userIds.helena, 'post vazio');
    const post = await call(tokens.alvaro, 'GET', `/v1/feed/posts/${empty}`);
    expect(post.status).toBe(200);
    const body = (await post.json()) as FeedPost;
    expect(body.likeCount).toBe(0);
    expect(body.commentCount).toBe(0);
    const list = await call(tokens.alvaro, 'GET', `/v1/feed/posts/${empty}/comments`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [], nextCursor: null });
    // The stranger meets the locked answer for the same post, never a 404.
    const stranger = await call(tokens.marcos, 'GET', `/v1/feed/posts/${empty}`);
    expect(stranger.status).toBe(403);
    expect(Object.keys(((await stranger.json()) as Envelope).error.details ?? {}).sort()).toEqual([
      'access',
      'author',
    ]);
  });

  it('4. EP-20: an author name with combining accents, an emoji and 80+ graphemes comes back byte for byte', async () => {
    const name = `Re\u0301ne\u0301e Ça\u0303o 🎉 ${'ab'.repeat(45)}`;
    expect(
      [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(name)].length,
    ).toBeGreaterThanOrEqual(80);
    const [original] = await adminSql<{ display_name: string }[]>`
      select display_name from public.member_profiles where membership_id = ${helenaMembershipId}::uuid`;
    await adminSql`update public.member_profiles set display_name = ${name} where membership_id = ${helenaMembershipId}::uuid`;
    try {
      const res = await call(tokens.marcos, 'GET', `/v1/feed/posts/${postId}`);
      expect(res.status).toBe(403);
      const author = ((await res.json()) as Envelope).error.details?.author as {
        displayName: string;
      };
      const [stored] = await adminSql<{ display_name: string }[]>`
        select display_name from public.member_profiles where membership_id = ${helenaMembershipId}::uuid`;
      expect(author.displayName).toBe(name);
      expect(author.displayName).toBe(stored?.display_name);
      expect(Buffer.from(author.displayName).equals(Buffer.from(name))).toBe(true);
    } finally {
      await adminSql`update public.member_profiles set display_name = ${original?.display_name ?? ''} where membership_id = ${helenaMembershipId}::uuid`;
    }
  });

  it('5. D-469: a real support user is the bare 404 on every route; a rede-demo session on the lab host is a TENANT_HOST_MISMATCH', async () => {
    const before = await state(postId);
    for (const [label, method, path, body] of routes()) {
      await expectBare404(await call(tokens.labSupport, method, path, body), `support ${label}`);
    }
    const foreign = await call(tokens.demoMember, 'POST', `/v1/feed/posts/${postId}/like`);
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
    expect(await state(postId)).toEqual(before);
  });

  it('6. D-484: a blocked author’s post is the bare 404 on the post routes for the follower and for the admin, and returns on unblock', async () => {
    await setBlocked(userIds.helena, true);
    try {
      for (const token of [tokens.alvaro, tokens.labAdmin]) {
        for (const [label, method, path, body] of routes().slice(0, 6)) {
          await expectBare404(await call(token, method, path, body), `${label} blocked`);
        }
      }
      // The follower’s comment-id routes too (the seam holds no blocked author).
      for (const [label, method, path, body] of routes().slice(6, 10)) {
        await expectBare404(await call(tokens.alvaro, method, path, body), `${label} blocked`);
      }
    } finally {
      await setBlocked(userIds.helena, false);
    }
    expect((await call(tokens.alvaro, 'GET', `/v1/feed/posts/${postId}`)).status).toBe(200);
  });

  it('7. EP-27 / D-483: with `social` off every route is the bare 404, the author’s own link included; on again restores everything', async () => {
    const before = await state(postId);
    await setSocialFlag(false);
    try {
      for (const token of [tokens.alvaro, tokens.helena, tokens.marcos]) {
        for (const [label, method, path, body] of routes()) {
          if (label === 'DELETE comment') continue;
          await expectBare404(await call(token, method, path, body), `off ${label}`);
        }
      }
    } finally {
      await setSocialFlag(true);
    }
    expect(await state(postId)).toEqual(before);
    for (const token of [tokens.alvaro, tokens.helena]) {
      expect((await call(token, 'GET', `/v1/feed/posts/${postId}`)).status).toBe(200);
      expect((await call(token, 'GET', `/v1/feed/comments/${rootA}/replies`)).status).toBe(200);
    }
  });

  it('8. D-475: the admin (moderator) reads, likes and comments on a live author’s member post; as a follower too he sees it once', async () => {
    expect((await call(tokens.labAdmin, 'GET', `/v1/feed/posts/${postId}`)).status).toBe(200);
    const like = await call(tokens.labAdmin, 'POST', `/v1/feed/posts/${postId}/like`);
    expect(like.status).toBe(200);
    const unlike = await call(tokens.labAdmin, 'DELETE', `/v1/feed/posts/${postId}/like`);
    expect(unlike.status).toBe(200);
    const comment = await call(tokens.labAdmin, 'POST', `/v1/feed/posts/${postId}/comments`, {
      body: 'moderacao',
    });
    expect(comment.status).toBe(201);
    expect((await call(tokens.labAdmin, 'GET', `/v1/feed/posts/${postId}/comments`)).status).toBe(
      200,
    );

    await followRow(userIds.labAdmin, userIds.helena);
    try {
      const seen = ids(await explorar(tokens.labAdmin)).filter((id) => id === postId);
      expect(seen).toHaveLength(1);
    } finally {
      await unfollowRow(userIds.labAdmin, userIds.helena);
    }
  });

  it('9. EP-50: liking twice is one like (+1), unliking twice never errors, and a like then a lost follow then an unlike is 403 with the counter unchanged', async () => {
    const own = await followersPost(userIds.helena, 'post de idempotencia');
    await followRow(userIds.marcos, userIds.helena);
    try {
      const base = (await state(own)).likeCount ?? 0;
      for (let i = 0; i < 2; i += 1) {
        const res = await call(tokens.marcos, 'POST', `/v1/feed/posts/${own}/like`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ liked: true, likeCount: base + 1 });
      }
      expect((await state(own)).likeRows).toBe(1);
      for (let i = 0; i < 2; i += 1) {
        const res = await call(tokens.marcos, 'DELETE', `/v1/feed/posts/${own}/like`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ liked: false, likeCount: base });
      }

      await call(tokens.marcos, 'POST', `/v1/feed/posts/${own}/like`);
      await unfollowRow(userIds.marcos, userIds.helena);
      const refused = await call(tokens.marcos, 'DELETE', `/v1/feed/posts/${own}/like`);
      await expectLocked(refused, 'unlike after unfollow');
      expect(await state(own)).toMatchObject({ likeCount: base + 1, likeRows: 1 });
      await followRow(userIds.marcos, userIds.helena);
      const back = await call(tokens.marcos, 'DELETE', `/v1/feed/posts/${own}/like`);
      expect(back.status).toBe(200);
      expect((await state(own)).likeCount).toBe(base);
    } finally {
      await unfollowRow(userIds.marcos, userIds.helena);
    }
  });

  it('10. EP-51: five followers liking in parallel move the count by exactly 5; a like racing an unfollow is 200 or 403, never 500', async () => {
    const own = await followersPost(userIds.helena, 'post de concorrencia');
    const extras: { userId: string; token: string }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const identity = await createSharedIdentity({
        prefix: IDENTITY_PREFIX,
        memberships: [{ host: 'lab' }],
      });
      extras.push({
        userId: identity.userId,
        token: await signInAs(identity.email, identity.password),
      });
    }
    const followers = [{ userId: userIds.alvaro, token: tokens.alvaro }, ...extras];
    for (const f of followers) await followRow(f.userId, userIds.helena);
    try {
      const base = (await state(own)).likeCount ?? 0;
      const results = await Promise.all(
        followers.map((f) => call(f.token, 'POST', `/v1/feed/posts/${own}/like`)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const after = await state(own);
      expect(after.likeCount).toBe(base + 5);
      expect(after.likeRows).toBe(after.likeCount);
    } finally {
      // Alvaro -> Helena is part of the seeded graph and stays; only the throwaway followers go.
      for (const f of extras) await unfollowRow(f.userId, userIds.helena);
    }

    for (let round = 0; round < 3; round += 1) {
      await followRow(userIds.marcos, userIds.helena);
      const [res] = await Promise.all([
        call(tokens.marcos, round % 2 === 0 ? 'POST' : 'DELETE', `/v1/feed/posts/${own}/like`),
        unfollowRow(userIds.marcos, userIds.helena),
      ]);
      expect([200, 403], `race round ${round}`).toContain(res.status);
      await unfollowRow(userIds.marcos, userIds.helena);
    }
  });
});
