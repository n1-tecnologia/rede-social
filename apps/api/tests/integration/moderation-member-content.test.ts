import { MODERATION_EXCERPT_MAX } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  communityCreateLimiter,
  storyPublishLimiter,
} from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { FeedPost } from '@rede-social/module-feed/contracts';
import { STORY_MAX_CAPTION, type StorySummary } from '@rede-social/module-stories/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 10-05 (D-711, MCOMM-10; A8; EP-24, EP-25, EP-35, EP-36, EP-37) against the live local stack and the real
 * seed: the COMMUNITY half of the member-content moderation, in the shape of `moderation-posts.test.ts`.
 *
 * A moderator (a holder of `communities.community.manage`, the lab admin) who is NOT the creator moves a
 * `kind = 'member'` community to `archived` or deletes it: ONE `moderation_log` row per action, written in
 * the SAME transaction as the community write (a log failure rolls the write back), naming the creator as
 * the target and the community NAME as the excerpt. The creator's own archive or delete, any action on an
 * organization community, a no-op repeat and an admin's edit of text write no row, and nobody is notified.
 *
 * The moderation log is APPEND-ONLY, so this suite never deletes log rows: every assertion is scoped by
 * the subject id it created. Fixture communities carry `PREFIX` and the test members' member communities
 * are swept in `beforeAll` and `afterAll`. Test ORDER inside a describe is load-bearing.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 10-05 mod ';
const tokens = { helena: '', marcos: '', labAdmin: '' };
const userIds = { helena: '', marcos: '', labAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreNotifications: () => Promise<void> = async () => {};

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });
const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

const create = async (token: string, name: string, description = ''): Promise<string> => {
  const res = await request('/v1/communities', token, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
  expect(res.status, `POST /v1/communities ${name}`).toBe(201);
  return ((await res.json()) as CommunitySummary).id;
};
const archive = (token: string, id: string) =>
  request(`/v1/communities/${id}`, token, patch({ status: 'archived' }));
const remove = (token: string, id: string) =>
  request(`/v1/communities/${id}`, token, { method: 'DELETE' });

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

type LogRow = {
  action: string;
  actor_user_id: string;
  target_user_id: string;
  subject_type: string | null;
  subject_id: string | null;
  excerpt: string | null;
  reason: string | null;
};

const logRowsFor = (subjectId: string) =>
  adminSql<LogRow[]>`
    select action, actor_user_id::text, target_user_id::text, subject_type, subject_id::text,
           excerpt, reason
      from public.moderation_log
     where tenant_id = ${labTenantId}::uuid and subject_id = ${subjectId}::uuid
     order by created_at, id`;

const stateOf = async (id: string) => {
  const [row] = await adminSql<{ status: string; deleted_at: string | null; name: string }[]>`
    select status, deleted_at::text, name from public.communities where id = ${id}::uuid`;
  return row;
};

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.feed_posts
     where community_id in (select id from public.communities where name like ${`${PREFIX}%`})`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
}

async function withNotificationsEnabled(): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${labTenantId}::uuid, 'notifications', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(labTenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    }
    moduleFlags.invalidate(labTenantId);
  };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  restoreNotifications = await withNotificationsEnabled();
  await sweep();
});

beforeEach(() => {
  communityCreateLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await restoreNotifications();
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('10 moderation of member communities', () => {
  beforeEach(async () => {
    await sweep();
  });

  it('EP-35 adjacency: a moderator’s archive then delete of a member community writes exactly two rows in that order, naming the creator and the community', async () => {
    const id = await create(tokens.helena, `${PREFIX}Corrida`, 'descrição que não vai ao log');
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const rows = await logRowsFor(id);
    expect(rows.map((row) => row.action)).toEqual(['community_archived', 'community_removed']);
    for (const row of rows) {
      expect(row.subject_type).toBe('community');
      expect(row.actor_user_id).toBe(userIds.labAdmin);
      expect(row.target_user_id).toBe(userIds.helena);
      expect(row.excerpt).toBe(`${PREFIX}Corrida`);
      expect(row.reason).toBeNull();
    }
  });

  it('EP-35: the creator’s own archive and delete write no row; an organization community’s archive and delete write none either', async () => {
    const own = await create(tokens.helena, `${PREFIX}própria`);
    expect((await archive(tokens.helena, own)).status).toBe(200);
    expect((await remove(tokens.helena, own)).status).toBe(204);
    expect(await logRowsFor(own)).toHaveLength(0);

    const org = await create(tokens.labAdmin, `${PREFIX}da organização`);
    expect((await archive(tokens.labAdmin, org)).status).toBe(200);
    expect((await remove(tokens.labAdmin, org)).status).toBe(204);
    expect(await logRowsFor(org)).toHaveLength(0);
  });

  it('EP-36: a member community with an empty description and no cover logs the capped name as the excerpt; the description never reaches the log', async () => {
    const empty = await create(tokens.helena, `${PREFIX}sem descrição`);
    expect((await archive(tokens.labAdmin, empty)).status).toBe(200);
    expect((await logRowsFor(empty))[0]?.excerpt).toBe(`${PREFIX}sem descrição`);

    const secret = 'SEGREDO-DA-DESCRICAO-10-05';
    const withText = await create(tokens.helena, `${PREFIX}com descrição`, secret);
    expect((await archive(tokens.labAdmin, withText)).status).toBe(200);
    const rows = await logRowsFor(withText);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('A8: an admin editing a member community’s name, description or cover is allowed and NOT logged', async () => {
    const id = await create(tokens.helena, `${PREFIX}editada pelo admin`);
    const edit = await request(
      `/v1/communities/${id}`,
      tokens.labAdmin,
      patch({ description: 'ajustada' }),
    );
    expect(edit.status).toBe(200);
    expect(await logRowsFor(id)).toHaveLength(0);
  });

  it('EP-24 idempotency: archiving an already archived community writes no second row; deleting twice answers the bare 404 the second time', async () => {
    const id = await create(tokens.helena, `${PREFIX}repetida`);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect(await logRowsFor(id)).toHaveLength(1);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const second = await remove(tokens.labAdmin, id);
    expect(second.status).toBe(404);
    expect((await errorOf(second)).details).toBeUndefined();
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual([
      'community_archived',
      'community_removed',
    ]);
  });

  it('EP-25 concurrency: the creator and a moderator archiving at the same time produce one transition and at most one row', async () => {
    const id = await create(tokens.helena, `${PREFIX}corrida de arquivos`);
    const [a, b] = await Promise.all([archive(tokens.helena, id), archive(tokens.labAdmin, id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await stateOf(id))?.status).toBe('archived');
    expect((await logRowsFor(id)).length).toBeLessThanOrEqual(1);
  });

  it('EP-37 ordering: the two rows list newest first through the moderation log, and nobody is notified', async () => {
    // The log is append-only and rows survive a rerun: a name unique to this run scopes the listing.
    const name = `${PREFIX}ordem do log ${Date.now()}`;
    const id = await create(tokens.helena, name);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const res = await request('/v1/admin/moderation-log?limit=50', tokens.labAdmin);
    expect(res.status).toBe(200);
    const items = (
      (await res.json()) as {
        items: { action: string; subjectType: string | null; excerpt: string | null }[];
      }
    ).items.filter((item) => item.excerpt === name);
    expect(items.map((item) => item.action)).toEqual(['community_removed', 'community_archived']);
    expect(items.every((item) => item.subjectType === 'community')).toBe(true);
    const [notified] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${labTenantId}::uuid and subject_id = ${id}::uuid`;
    expect(notified?.n).toBe(0);
  });

  it('EP-37 / T-10-17: the log insert is in the community write’s transaction - a forced log failure leaves the community unchanged', async () => {
    const id = await create(tokens.helena, `${PREFIX}atomicidade`);
    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await archive(tokens.labAdmin, id);
      expect(res.status).toBe(500);
      expect((await stateOf(id))?.status).toBe('active');
      expect(await logRowsFor(id)).toHaveLength(0);
      // Archived by the creator (no row needed), then the moderator's DELETE fails the same way.
      expect((await archive(tokens.helena, id)).status).toBe(200);
      const del = await remove(tokens.labAdmin, id);
      expect(del.status).toBe(500);
      expect((await stateOf(id))?.deleted_at).toBeNull();
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }
    // Positive control: with the log working again the removal commits with its row.
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual(['community_removed']);
  });

  it('D-718 / MPUB-05: with social off the moderator’s archive and delete still work (and log) while the creator’s write is 403', async () => {
    const id = await create(tokens.helena, `${PREFIX}social desligado`);
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      const own = await request(
        `/v1/communities/${id}`,
        tokens.helena,
        patch({ name: `${PREFIX}renomeada` }),
      );
      expect(own.status).toBe(403);
      expect((await remove(tokens.helena, id)).status).toBe(403);
      expect((await archive(tokens.labAdmin, id)).status).toBe(200);
      expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual([
      'community_archived',
      'community_removed',
    ]);
  });
});

/**
 * 10-06 (A3, MCOMM-11, EP-38): a holder of `moderation.manage` removes ONE post inside a member community,
 * without archiving the community. Same shape as `moderation-posts.test.ts` (the Phase 9 analog for a
 * `followers` post): the lock read, the soft delete, ONE `post_removed` row in the same transaction, the
 * creator told nothing. The edges are the planner's choice (live creator, blocked creator, already deleted,
 * `social` off, an organization post that stays author-only, a report resolved as `remove_content`).
 */
describe('10 community post removal', () => {
  const IDENTITY_PREFIX = 'mod1006';
  const throwAdmin = { token: '' };
  const publish = async (
    token: string,
    communityId: string,
    caption: string,
  ): Promise<FeedPost> => {
    const res = await request('/v1/feed/posts', token, {
      method: 'POST',
      body: JSON.stringify({ caption, communityId }),
    });
    expect(res.status, `POST /v1/feed/posts ${caption}`).toBe(201);
    return (await res.json()) as FeedPost;
  };
  const removePost = (token: string, postId: string) =>
    request(`/v1/feed/posts/${postId}`, token, { method: 'DELETE' });
  const postState = async (postId: string) => {
    const [row] = await adminSql<
      { deleted_at: string | null; deleted_by_user_id: string | null }[]
    >`
      select deleted_at::text, deleted_by_user_id::text from public.feed_posts where id = ${postId}::uuid`;
    return row;
  };
  const postCount = async (communityId: string) => {
    const [row] = await adminSql<{ post_count: number }[]>`
      select post_count from public.communities where id = ${communityId}::uuid`;
    return row?.post_count;
  };
  const notificationsOf = async (userId: string) => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;
    return row?.n ?? 0;
  };
  const setBlocked = (blocked: boolean) =>
    adminSql`
      update public.memberships set blocked_at = ${blocked ? new Date().toISOString() : null}
       where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid`;
  const expectBare404 = async (res: Response, label: string): Promise<void> => {
    expect(res.status, label).toBe(404);
    const error = await errorOf(res);
    expect(error.code, label).toBe('NOT_FOUND');
    expect(error.details, label).toBeUndefined();
  };

  beforeAll(async () => {
    await removeIdentitiesByPrefix(IDENTITY_PREFIX);
    const colleague = await createSharedIdentity({
      prefix: IDENTITY_PREFIX,
      memberships: [{ host: 'lab', role: 'admin_tenant', displayName: 'Admin Colega' }],
    });
    throwAdmin.token = await signInAs(colleague.email, colleague.password);
  });

  beforeEach(async () => {
    await sweep();
    await setBlocked(false);
  });

  afterAll(async () => {
    await setBlocked(false);
    await removeIdentitiesByPrefix(IDENTITY_PREFIX);
  });

  it('A3 / T-10-24: the moderator removes one community post: 200 { deleted: true }, stamped, ONE post_removed row, the community and its other posts intact, post_count reconciled, the creator told nothing', async () => {
    const community = await create(tokens.helena, `${PREFIX}Posts removíveis`);
    const doomed = await publish(tokens.helena, community, `${PREFIX}legenda para remover`);
    const kept = await publish(tokens.helena, community, `${PREFIX}legenda que fica`);
    expect(await postCount(community)).toBe(2);
    const told = await notificationsOf(userIds.helena);

    const res = await removePost(tokens.labAdmin, doomed.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"deleted":true}');
    const state = await postState(doomed.id);
    expect(state?.deleted_at).not.toBeNull();
    expect(state?.deleted_by_user_id).toBe(userIds.labAdmin);

    const rows = await logRowsFor(doomed.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'post_removed',
      actor_user_id: userIds.labAdmin,
      target_user_id: userIds.helena,
      subject_type: 'feed_post',
      subject_id: doomed.id,
      excerpt: `${PREFIX}legenda para remover`,
      reason: null,
    });

    // The community and its other post are untouched; the counter followed the removal.
    expect((await stateOf(community))?.status).toBe('active');
    expect((await stateOf(community))?.deleted_at).toBeNull();
    expect((await postState(kept.id))?.deleted_at).toBeNull();
    expect(await postCount(community)).toBe(1);
    const page = await request(`/v1/feed?communityId=${community}&limit=25`, tokens.marcos);
    expect(((await page.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      kept.id,
    ]);
    // Nobody is told: no new row for the creator after the fan-out and retraction jobs.
    await runNotificationJobs(labTenantId);
    expect(await notificationsOf(userIds.helena)).toBe(told);
  });

  it('the creator deleting their own community post is an author delete: stamped, no log row; a second removal is the bare 404 and writes no second row', async () => {
    const community = await create(tokens.helena, `${PREFIX}Autoria`);
    const own = await publish(tokens.helena, community, `${PREFIX}minha`);
    expect((await removePost(tokens.helena, own.id)).status).toBe(200);
    expect((await postState(own.id))?.deleted_by_user_id).toBe(userIds.helena);
    expect(await logRowsFor(own.id)).toHaveLength(0);

    const other = await publish(tokens.helena, community, `${PREFIX}outra`);
    expect((await removePost(tokens.labAdmin, other.id)).status).toBe(200);
    await expectBare404(await removePost(tokens.labAdmin, other.id), 'repeat removal');
    expect(await logRowsFor(other.id)).toHaveLength(1);
  });

  it('a member who is not the creator cannot remove the post (the bare 404, nothing removed)', async () => {
    const community = await create(tokens.helena, `${PREFIX}Alheia`);
    const target = await publish(tokens.helena, community, `${PREFIX}de Helena`);
    const refused = await removePost(tokens.marcos, target.id);
    expect([403, 404]).toContain(refused.status);
    expect((await postState(target.id))?.deleted_at).toBeNull();
    expect(await logRowsFor(target.id)).toHaveLength(0);
  });

  it('D-718: with social off the removal still works (and logs)', async () => {
    const community = await create(tokens.helena, `${PREFIX}Sem social`);
    const target = await publish(tokens.helena, community, `${PREFIX}social desligado`);
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      expect((await removePost(tokens.labAdmin, target.id)).status).toBe(200);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    expect(await logRowsFor(target.id)).toHaveLength(1);
  });

  it('a blocked creator’s post is the bare 404 even for the moderator (nothing removed, no row) until unblocked', async () => {
    const community = await create(tokens.helena, `${PREFIX}Bloqueada`);
    const target = await publish(tokens.helena, community, `${PREFIX}de quem será bloqueada`);
    await setBlocked(true);
    await expectBare404(await removePost(tokens.labAdmin, target.id), 'blocked creator');
    expect((await postState(target.id))?.deleted_at).toBeNull();
    expect(await logRowsFor(target.id)).toHaveLength(0);
    await setBlocked(false);
    expect((await removePost(tokens.labAdmin, target.id)).status).toBe(200);
    expect(await logRowsFor(target.id)).toHaveLength(1);
  });

  it('an ORGANIZATION post stays author-only: a colleague admin gets the bare 404 and no row (positive control: the author’s own delete)', async () => {
    const org = await create(tokens.labAdmin, `${PREFIX}Da organização`);
    const post = await publish(tokens.labAdmin, org, `${PREFIX}aviso`);
    await expectBare404(await removePost(throwAdmin.token, post.id), 'colleague removes org post');
    expect((await postState(post.id))?.deleted_at).toBeNull();
    expect(await logRowsFor(post.id)).toHaveLength(0);
    expect((await removePost(tokens.labAdmin, post.id)).status).toBe(200);
    expect(await logRowsFor(post.id)).toHaveLength(0);
  });

  it('a report resolved as remove_content for a community post removes it with the same log row', async () => {
    const community = await create(tokens.helena, `${PREFIX}Denunciada`);
    const target = await publish(tokens.helena, community, `${PREFIX}denunciar`);
    const filed = await request('/v1/reports', tokens.marcos, {
      method: 'POST',
      body: JSON.stringify({ subjectType: 'feed_post', subjectId: target.id, reason: 'spam' }),
    });
    expect(filed.status).toBe(201);
    const reportId = ((await filed.json()) as { id: string }).id;
    try {
      const resolved = await request(`/v1/admin/reports/${reportId}/resolve`, tokens.labAdmin, {
        method: 'POST',
        body: JSON.stringify({ resolution: 'remove_content' }),
      });
      expect(resolved.status).toBe(200);
      expect((await postState(target.id))?.deleted_at).not.toBeNull();
      const rows = await logRowsFor(target.id);
      expect(rows.map((row) => row.action)).toEqual(['post_removed']);
      expect(rows[0]?.target_user_id).toBe(userIds.helena);
      const [report] = await adminSql<{ status: string }[]>`
        select status from public.content_reports where id = ${reportId}::uuid`;
      expect(report?.status).toBe('content_removed');
    } finally {
      await adminSql`delete from public.content_reports where id = ${reportId}::uuid`;
    }
  });
});

/**
 * 10-07 (D-711, D-717, D-718; MSTORY-09, EP-69): a holder of `moderation.manage` removes any MEMBER story,
 * and the removal leaves ONE `story_removed` row in the SAME transaction (a failing log insert rolls the
 * delete back). The author's own delete, an organization story's delete by a manager, a repeat and a
 * missing id write no row, and nobody is notified. Every assertion is scoped by the story id it created
 * (the log is append-only), and the stories this suite writes carry `STORY_PREFIX`.
 */
describe('10 story removal', () => {
  const STORY_PREFIX = 'Teste 10-07 mod ';
  const createdAssets: string[] = [];

  const sweepStories = async (): Promise<void> => {
    await adminSql`delete from public.notifications where payload::text like ${`%${STORY_PREFIX}%`}`;
    await adminSql`delete from public.stories where caption like ${`${STORY_PREFIX}%`}`;
    for (const id of createdAssets.splice(0)) {
      await adminSql`delete from public.stories where media_asset_id = ${id}::uuid`;
      await adminSql`delete from public.media_assets where id = ${id}::uuid`;
    }
  };

  /** A member (or admin) story published through the real route, on an asset the caller owns. */
  const publishStory = async (
    token: string,
    ownerId: string,
    caption: string,
  ): Promise<StorySummary> => {
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${labTenantId}::uuid, ${ownerId}::uuid, 'image', 'story', 'ready', 'supabase',
              'image/webp', 1024, '{640,1080}'::int[])
      returning id`;
    const assetId = asset?.id ?? '';
    createdAssets.push(assetId);
    const res = await request('/v1/stories', token, {
      method: 'POST',
      body: JSON.stringify({ mediaAssetId: assetId, mediaKind: 'image', caption }),
    });
    expect(res.status, `POST /v1/stories ${caption}`).toBe(201);
    return (await res.json()) as StorySummary;
  };

  const removeStory = (token: string, id: string) =>
    request(`/v1/stories/${id}`, token, { method: 'DELETE' });

  const storyState = async (id: string) => {
    const [row] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at::text from public.stories where id = ${id}::uuid`;
    return row;
  };

  beforeEach(async () => {
    storyPublishLimiter.reset();
    await sweepStories();
  });

  afterAll(async () => {
    await sweepStories();
  });

  it('a moderator’s delete of a member story writes ONE story_removed row naming the author, the story and the capped caption; the story leaves every read', async () => {
    // A caption over the excerpt budget: the log keeps a capped, word-cut snapshot, never the whole text.
    const caption = `${STORY_PREFIX}${'palavra '.repeat(40)}`.slice(0, STORY_MAX_CAPTION);
    const story = await publishStory(tokens.helena, userIds.helena, caption);
    expect(caption.length).toBeGreaterThan(MODERATION_EXCERPT_MAX - 1);
    const res = await removeStory(tokens.labAdmin, story.id);
    expect(res.status).toBe(204);
    expect((await storyState(story.id))?.deleted_at).not.toBeNull();
    const rows = await logRowsFor(story.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('story_removed');
    expect(rows[0]?.subject_type).toBe('story');
    expect(rows[0]?.actor_user_id).toBe(userIds.labAdmin);
    expect(rows[0]?.target_user_id).toBe(userIds.helena);
    expect(rows[0]?.reason).toBeNull();
    expect(rows[0]?.excerpt?.length ?? 0).toBeLessThanOrEqual(MODERATION_EXCERPT_MAX);
    expect(rows[0]?.excerpt?.startsWith(STORY_PREFIX.trim())).toBe(true);
    const mine = await request('/v1/stories/mine?limit=50', tokens.helena);
    expect(((await mine.json()) as { items: StorySummary[] }).items.map((s) => s.id)).not.toContain(
      story.id,
    );
  });

  it('a second delete is the bare 404 and writes no second row', async () => {
    const story = await publishStory(tokens.helena, userIds.helena, `${STORY_PREFIX}repetida`);
    expect((await removeStory(tokens.labAdmin, story.id)).status).toBe(204);
    const second = await removeStory(tokens.labAdmin, story.id);
    expect(second.status).toBe(404);
    expect((await errorOf(second)).details).toBeUndefined();
    expect(await logRowsFor(story.id)).toHaveLength(1);
  });

  it('the author’s own delete writes no row; an organization story deleted by an admin writes none either', async () => {
    const own = await publishStory(tokens.helena, userIds.helena, `${STORY_PREFIX}própria`);
    expect((await removeStory(tokens.helena, own.id)).status).toBe(204);
    expect(await logRowsFor(own.id)).toHaveLength(0);

    const org = await publishStory(
      tokens.labAdmin,
      userIds.labAdmin,
      `${STORY_PREFIX}da organização`,
    );
    expect((await removeStory(tokens.labAdmin, org.id)).status).toBe(204);
    expect(await logRowsFor(org.id)).toHaveLength(0);
  });

  it('T-10-28: the log insert is in the delete’s transaction - a forced log failure leaves the story live; with the log working again the delete commits with its row', async () => {
    const story = await publishStory(tokens.helena, userIds.helena, `${STORY_PREFIX}atomicidade`);
    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await removeStory(tokens.labAdmin, story.id);
      expect(res.status).toBe(500);
      expect((await storyState(story.id))?.deleted_at).toBeNull();
      expect(await logRowsFor(story.id)).toHaveLength(0);
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }
    expect((await removeStory(tokens.labAdmin, story.id)).status).toBe(204);
    expect((await logRowsFor(story.id)).map((row) => row.action)).toEqual(['story_removed']);
  });

  it('D-718: with social off the moderator’s delete still works (and logs) while Helena’s publish is 403', async () => {
    const story = await publishStory(
      tokens.helena,
      userIds.helena,
      `${STORY_PREFIX}social desligado`,
    );
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      const [asset] = await adminSql<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
        values (${labTenantId}::uuid, ${userIds.helena}::uuid, 'image', 'story', 'ready', 'supabase',
                'image/webp', 1024, '{640,1080}'::int[])
        returning id`;
      createdAssets.push(asset?.id ?? '');
      const publish = await request('/v1/stories', tokens.helena, {
        method: 'POST',
        body: JSON.stringify({
          mediaAssetId: asset?.id,
          mediaKind: 'image',
          caption: `${STORY_PREFIX}negada`,
        }),
      });
      expect(publish.status).toBe(403);
      expect((await removeStory(tokens.labAdmin, story.id)).status).toBe(204);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    expect((await logRowsFor(story.id)).map((row) => row.action)).toEqual(['story_removed']);
  });

  it('the author is told nothing, and GET /v1/admin/moderation-log lists the row', async () => {
    const name = `${STORY_PREFIX}notificacao ${Date.now()}`;
    const story = await publishStory(tokens.helena, userIds.helena, name);
    expect((await removeStory(tokens.labAdmin, story.id)).status).toBe(204);
    await runNotificationJobs(labTenantId);
    const [told] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${labTenantId}::uuid and user_id = ${userIds.helena}::uuid
         and subject_id = ${story.id}::uuid`;
    expect(told?.n).toBe(0);
    const res = await request('/v1/admin/moderation-log?limit=50', tokens.labAdmin);
    expect(res.status).toBe(200);
    const items = (
      (await res.json()) as {
        items: { action: string; subjectType: string | null; excerpt: string | null }[];
      }
    ).items.filter((item) => item.excerpt === name);
    expect(items.map((item) => item.action)).toEqual(['story_removed']);
    expect(items[0]?.subjectType).toBe('story');
  });
});
