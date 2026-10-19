import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { feedNotificationSources } from '@rede-social/module-feed/server';
import { notificationsSystemCtx } from '@rede-social/module-notifications/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withSocialEnabled } from './setup';

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
    // Even by id: the restrictive policy hides it, so the detail read is the bare 404.
    const detail = await request(`/v1/feed/posts/${plantedId}`, tokens.alvaro);
    expect(detail.status).toBe(404);
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
