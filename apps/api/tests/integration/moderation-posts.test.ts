import { createECDH, randomBytes } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { FeedComment, FeedPage, FeedPost } from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  pushSendJobsOf,
  removeIdentitiesByPrefix,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
  withSocialEnabled,
} from './setup';

/**
 * 09-07 (SOCIAL-07, SOCIAL-08; D-475, D-476, D-477) against the live local stack and the real seed.
 *
 * `09 tracer` is ONE removal through every layer: the lab admin (a holder of `moderation.manage`)
 * removes Helena's member post through `DELETE /v1/feed/posts/{id}`; the post is soft-deleted and
 * stamped, ONE `moderation_log` row commits in the same transaction, Helena is told nothing and the
 * post leaves every read. `09 scope` is what the removal must NOT do (an organization post stays
 * author-only, T-04-54 / T-09-22) and the atomicity and race cases (T-09-23, EP-12, EP-22..24).
 * `09 notice` (Task 2) is the single comment notice of D-477.
 *
 * The moderation log is APPEND-ONLY, so this suite never deletes log rows: every assertion is scoped
 * by the subject id it created. Fixture posts carry `PREFIX` and are swept by prefix in `beforeAll`
 * (a crashed run) and `afterAll`. Test ORDER is load-bearing (declaration order).
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 09-07 ';
const IDENTITY_PREFIX = 'mod09';
const tokens = {
  helena: '',
  alvaro: '',
  marcos: '',
  labAdmin: '',
  labAdmin2: '',
  labSupport: '',
  throwAdmin: '',
  author: '',
};
const userIds = { helena: '', alvaro: '', marcos: '', labAdmin: '', author: '', throwAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreNotifications: () => Promise<void> = async () => {};

/**
 * The lab seed has `notifications` OFF, and the sink enqueues nothing for a tenant without it, so
 * "Helena is told nothing" and the whole `09 notice` block would pass vacuously. Turn it on for the
 * run (the `withModuleEnabled` posture: write back the previous row, drop the flags cache).
 */
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

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const publish = async (token: string, caption: string): Promise<FeedPost> => {
  const res = await request('/v1/feed/posts', token, {
    method: 'POST',
    body: JSON.stringify({ caption }),
  });
  expect(res.status, `POST /v1/feed/posts ${caption}`).toBe(201);
  return (await res.json()) as FeedPost;
};

const remove = (token: string, postId: string) =>
  request(`/v1/feed/posts/${postId}`, token, { method: 'DELETE' });

const explorar = async (token: string): Promise<FeedPost[]> => {
  const res = await request('/v1/feed?scope=explorar&limit=25', token);
  expect(res.status, 'GET /v1/feed?scope=explorar').toBe(200);
  return ((await res.json()) as FeedPage).items;
};

const getPost = (token: string, postId: string) => request(`/v1/feed/posts/${postId}`, token);

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

type LogRow = {
  id: string;
  tenant_id: string;
  action: string;
  actor_user_id: string;
  actor_membership_id: string;
  target_user_id: string;
  target_membership_id: string;
  subject_type: string | null;
  subject_id: string | null;
  excerpt: string | null;
  reason: string | null;
};

const logRowsFor = (subjectId: string) =>
  adminSql<LogRow[]>`
    select id::text, tenant_id::text, action, actor_user_id::text, actor_membership_id::text,
           target_user_id::text, target_membership_id::text, subject_type, subject_id::text,
           excerpt, reason
      from public.moderation_log
     where subject_id = ${subjectId}::uuid`;

const postState = async (postId: string) => {
  const [row] = await adminSql<{ deleted_at: Date | null; deleted_by_user_id: string | null }[]>`
    select deleted_at, deleted_by_user_id::text as deleted_by_user_id
      from public.feed_posts where id = ${postId}::uuid`;
  return row;
};

const notificationCount = async (userId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.notifications
     where tenant_id = ${labTenantId}::uuid and user_id = ${userId}::uuid`;
  return row?.n ?? 0;
};

async function expectBare404(res: Response, label: string): Promise<void> {
  expect(res.status, label).toBe(404);
  const body = (await res.json()) as Envelope;
  expect(body.error.code, label).toBe('NOT_FOUND');
  expect(body.error.details, label).toBeUndefined();
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.notifications where payload->>'postId' in (
      select id::text from public.feed_posts where caption like ${`${PREFIX}%`})`;
  await adminSql`delete from public.feed_posts where caption like ${`${PREFIX}%`}`;
  await adminSql`delete from public.feed_posts
                  where author_user_id in (select id from auth.users where email like ${`${IDENTITY_PREFIX}-%`})`;
}

const setBlocked = (userId: string, blocked: boolean) =>
  adminSql`
    update public.memberships
       set status = ${blocked ? 'blocked' : 'active'}, blocked_at = ${blocked ? new Date() : null}
     where user_id = ${userId}::uuid and tenant_id = ${labTenantId}::uuid`;

const removedEvents: string[] = [];
const unsubscribers: (() => void)[] = [];

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  await removeIdentitiesByPrefix(IDENTITY_PREFIX);
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.alvaro = await signInAs('alvaro.pinheiro@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  // A SECOND session of the same admin: the concurrency case races two moderator sessions.
  tokens.labAdmin2 = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.alvaro = await userOf('alvaro.pinheiro@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  restoreNotifications = await withNotificationsEnabled();

  // Throwaway identities: a SECOND admin (a colleague, T-04-54) and a member whose membership the
  // blocked-author case may flip without touching a seeded person.
  const throwAdmin = await createSharedIdentity({
    prefix: IDENTITY_PREFIX,
    memberships: [{ host: 'lab', role: 'admin_tenant', displayName: 'Admin Colega' }],
  });
  userIds.throwAdmin = throwAdmin.userId;
  tokens.throwAdmin = await signInAs(throwAdmin.email, throwAdmin.password);
  const author = await createSharedIdentity({
    prefix: IDENTITY_PREFIX,
    memberships: [{ host: 'lab', role: 'member', displayName: 'Autora Bloqueavel' }],
  });
  userIds.author = author.userId;
  tokens.author = await signInAs(author.email, author.password);

  unsubscribers.push(
    subscribe('post.deleted', async (payload) => {
      removedEvents.push(payload.postId);
    }),
  );
  await sweep();
});

afterAll(async () => {
  for (const off of unsubscribers) off();
  await sweep();
  await removeIdentitiesByPrefix(IDENTITY_PREFIX);
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'
       and data->>'tenantId' = ${labTenantId}`;
  await restoreNotifications();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('09 tracer', () => {
  const posted: { helena?: FeedPost } = {};

  it('1. D-475: the admin removes Helena’s member post: 200 { deleted: true }, stamped, ONE log row, nobody named', async () => {
    posted.helena = await publish(tokens.helena, `${PREFIX}legenda da Helena para remover`);
    const postId = posted.helena.id;
    const helenaNotifications = await notificationCount(userIds.helena);

    // The moderator's Explorar carries `removal: 'moderation'` on it; Helena's and a follower's do not.
    const adminItem = (await explorar(tokens.labAdmin)).find((post) => post.id === postId);
    expect(adminItem?.removal).toBe('moderation');
    expect(adminItem?.canManage).toBe(false);
    const followerItem = (await explorar(tokens.alvaro)).find((post) => post.id === postId);
    expect(followerItem).toBeDefined();
    expect('removal' in (followerItem ?? {})).toBe(false);
    const ownItem = (await explorar(tokens.helena)).find((post) => post.id === postId);
    expect('removal' in (ownItem ?? {})).toBe(false);
    expect(ownItem?.canManage).toBe(true);

    const res = await remove(tokens.labAdmin, postId);
    expect(res.status).toBe(200);
    // The response names nobody: the body is exactly `{ deleted: true }`.
    expect(await res.text()).toBe('{"deleted":true}');

    const state = await postState(postId);
    expect(state?.deleted_at).not.toBeNull();
    expect(state?.deleted_by_user_id).toBe(userIds.labAdmin);

    const log = await logRowsFor(postId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      tenant_id: labTenantId,
      action: 'post_removed',
      actor_user_id: userIds.labAdmin,
      target_user_id: userIds.helena,
      subject_type: 'feed_post',
      subject_id: postId,
      excerpt: `${PREFIX}legenda da Helena para remover`,
      reason: null,
    });
    // Anchored to the two MEMBERSHIPS of this tenant.
    const memberships = await adminSql<{ id: string; user_id: string }[]>`
      select id::text, user_id::text from public.memberships
       where tenant_id = ${labTenantId}::uuid and user_id in (${userIds.labAdmin}::uuid, ${userIds.helena}::uuid)`;
    const byUser = new Map(memberships.map((m) => [m.user_id, m.id]));
    expect(log[0]?.actor_membership_id).toBe(byUser.get(userIds.labAdmin));
    expect(log[0]?.target_membership_id).toBe(byUser.get(userIds.helena));

    // Helena is told nothing (D-335 silence): no new row after the retraction and fan-out jobs.
    await runNotificationJobs(labTenantId);
    expect(await notificationCount(userIds.helena)).toBe(helenaNotifications);
  });

  it('2. the removed post leaves Explorar (the follower’s, the author’s, the moderator’s) and the post link', async () => {
    const postId = posted.helena?.id ?? '';
    for (const [label, token] of [
      ['alvaro', tokens.alvaro],
      ['helena', tokens.helena],
      ['admin', tokens.labAdmin],
    ] as const) {
      expect(
        (await explorar(token)).map((post) => post.id),
        label,
      ).not.toContain(postId);
      await expectBare404(await getPost(token, postId), `GET post as ${label}`);
    }
  });

  it('3. a repeat removal is the bare 404 and writes no second log row', async () => {
    const postId = posted.helena?.id ?? '';
    await expectBare404(await remove(tokens.labAdmin, postId), 'repeat removal');
    expect(await logRowsFor(postId)).toHaveLength(1);
  });
});

describe('09 scope', () => {
  it('1. EP-22 / T-09-22: a colleague admin cannot remove an organization post (bare 404, no log row); a member post in the same second succeeds', async () => {
    const org = await publish(tokens.labAdmin, `${PREFIX}aviso da diretoria`);
    const member = await publish(tokens.helena, `${PREFIX}post de membro, mesmo segundo`);

    await expectBare404(await remove(tokens.throwAdmin, org.id), 'colleague removes org post');
    expect((await postState(org.id))?.deleted_at).toBeNull();
    expect(await logRowsFor(org.id)).toHaveLength(0);

    const res = await remove(tokens.throwAdmin, member.id);
    expect(res.status).toBe(200);
    expect(await logRowsFor(member.id)).toHaveLength(1);

    // The organization post is still the author's to remove: an author delete, no log row.
    const own = await remove(tokens.labAdmin, org.id);
    expect(own.status).toBe(200);
    const state = await postState(org.id);
    expect(state?.deleted_at).not.toBeNull();
    expect(state?.deleted_by_user_id).toBe(userIds.labAdmin);
    expect(await logRowsFor(org.id)).toHaveLength(0);
  });

  it('2. an author deleting their OWN member post is an author delete: stamped, no log row', async () => {
    const mine = await publish(tokens.helena, `${PREFIX}post que a autora apaga`);
    const res = await remove(tokens.helena, mine.id);
    expect(res.status).toBe(200);
    const state = await postState(mine.id);
    expect(state?.deleted_at).not.toBeNull();
    expect(state?.deleted_by_user_id).toBe(userIds.helena);
    expect(await logRowsFor(mine.id)).toHaveLength(0);
  });

  it('3. a real support session is refused (403) and so is a member who is not the author; nothing is removed', async () => {
    const target = await publish(tokens.helena, `${PREFIX}post fora do alcance`);
    const asSupport = await remove(tokens.labSupport, target.id);
    expect(asSupport.status).toBe(403);
    const asMember = await remove(tokens.marcos, target.id);
    expect([403, 404]).toContain(asMember.status);
    expect((await postState(target.id))?.deleted_at).toBeNull();
    expect(await logRowsFor(target.id)).toHaveLength(0);
  });

  it('4. a blocked author’s post is the bare 404 for the admin until unblocked (flagged default of plan 04)', async () => {
    const target = await publish(tokens.author, `${PREFIX}post de quem sera bloqueada`);
    await setBlocked(userIds.author, true);
    try {
      await expectBare404(await remove(tokens.labAdmin, target.id), 'blocked author removal');
      expect((await postState(target.id))?.deleted_at).toBeNull();
      expect(await logRowsFor(target.id)).toHaveLength(0);
    } finally {
      await setBlocked(userIds.author, false);
    }
    const res = await remove(tokens.labAdmin, target.id);
    expect(res.status).toBe(200);
    expect(await logRowsFor(target.id)).toHaveLength(1);
  });

  it('5. EP-23: a media-only member post (empty caption) is removable and logs the empty excerpt', async () => {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, visibility)
      values (${labTenantId}::uuid, ${userIds.helena}::uuid, '', 'followers')
      returning id`;
    const postId = row?.id ?? '';
    const res = await remove(tokens.labAdmin, postId);
    expect(res.status).toBe(200);
    const log = await logRowsFor(postId);
    expect(log).toHaveLength(1);
    expect(log[0]?.excerpt).toBe('');
    expect(log[0]?.action).toBe('post_removed');
    await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
  });

  it('6. a long caption is cut to the 280-unit rule in the log row, with the ellipsis inside the cap', async () => {
    const long = `${PREFIX}${Array.from({ length: 90 }, () => 'palavra').join(' ')}`;
    const post = await publish(tokens.helena, long);
    expect((await remove(tokens.labAdmin, post.id)).status).toBe(200);
    const [row] = await logRowsFor(post.id);
    expect(row?.excerpt?.length).toBeLessThanOrEqual(280);
    expect(row?.excerpt?.endsWith('…')).toBe(true);
  });

  it('7. EP-12: a removal wins an author edit (sequential: 404), and a raced edit never outlives the delete', async () => {
    const first = await publish(tokens.helena, `${PREFIX}edicao depois da remocao`);
    expect((await remove(tokens.labAdmin, first.id)).status).toBe(200);
    const late = await request(`/v1/feed/posts/${first.id}`, tokens.helena, {
      method: 'PATCH',
      body: JSON.stringify({ caption: `${PREFIX}editado tarde` }),
    });
    await expectBare404(late, 'edit after removal');

    const raced = await publish(tokens.helena, `${PREFIX}edicao corrida`);
    const [removal, edit] = await Promise.all([
      remove(tokens.labAdmin, raced.id),
      request(`/v1/feed/posts/${raced.id}`, tokens.helena, {
        method: 'PATCH',
        body: JSON.stringify({ caption: `${PREFIX}editado em corrida` }),
      }),
    ]);
    expect(removal.status).toBe(200);
    expect([200, 404]).toContain(edit.status);
    expect((await postState(raced.id))?.deleted_at).not.toBeNull();
    expect(await logRowsFor(raced.id)).toHaveLength(1);
  });

  it('8. EP-12: two simultaneous moderator removals write ONE log row; the second is the bare 404', async () => {
    const post = await publish(tokens.helena, `${PREFIX}duas remocoes ao mesmo tempo`);
    const [a, b] = await Promise.all([
      remove(tokens.labAdmin, post.id),
      remove(tokens.labAdmin2, post.id),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const loser = a.status === 404 ? a : b;
    expect(((await loser.json()) as Envelope).error.code).toBe('NOT_FOUND');
    expect(await logRowsFor(post.id)).toHaveLength(1);
  });

  it('9. EP-24 / T-09-23: a failing log insert leaves the post live, emits no post.deleted and writes no row', async () => {
    const post = await publish(tokens.helena, `${PREFIX}atomicidade da remocao`);
    const eventsBefore = removedEvents.length;

    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await remove(tokens.labAdmin, post.id);
      expect(res.status).toBe(500);
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }

    const state = await postState(post.id);
    expect(state?.deleted_at).toBeNull();
    expect(state?.deleted_by_user_id).toBeNull();
    expect(removedEvents.length).toBe(eventsBefore);
    expect(await logRowsFor(post.id)).toHaveLength(0);
    // The post is still readable and still removable once the log works again.
    expect((await getPost(tokens.alvaro, post.id)).status).toBe(200);
    expect((await remove(tokens.labAdmin, post.id)).status).toBe(200);
    expect(removedEvents.length).toBe(eventsBefore + 1);
  });

  it('10. `removal` reaches the moderator only: the post link carries it for the admin, never for a member or on the admin’s own post', async () => {
    const memberPost = await publish(tokens.helena, `${PREFIX}campo removal`);
    const orgPost = await publish(tokens.labAdmin, `${PREFIX}campo removal da diretoria`);

    const asAdmin = (await (await getPost(tokens.labAdmin, memberPost.id)).json()) as FeedPost;
    expect(asAdmin.removal).toBe('moderation');
    const asFollower = (await (await getPost(tokens.alvaro, memberPost.id)).json()) as FeedPost;
    expect('removal' in asFollower).toBe(false);
    const adminOwn = (await (await getPost(tokens.labAdmin, orgPost.id)).json()) as FeedPost;
    expect('removal' in adminOwn).toBe(false);
    expect(adminOwn.canManage).toBe(true);
    const colleague = (await (await getPost(tokens.throwAdmin, orgPost.id)).json()) as FeedPost;
    expect('removal' in colleague).toBe(false);
  });
});

describe('09 notice', () => {
  type NoticeRow = {
    id: string;
    user_id: string;
    kind: string;
    object_id: string | null;
    actor_user_id: string | null;
    dedupe_key: string;
    payload: Record<string, unknown>;
  };

  const rowsAbout = (postId: string) =>
    adminSql<NoticeRow[]>`
      select id::text, user_id::text as user_id, kind, object_id::text as object_id,
             actor_user_id::text as actor_user_id, dedupe_key, payload
        from public.notifications
       where tenant_id = ${labTenantId}::uuid and subject_id = ${postId}::uuid
       order by created_at, id`;

  const commentOn = async (
    token: string,
    postId: string,
    body: string,
    parentId?: string,
  ): Promise<FeedComment> => {
    const res = await request(`/v1/feed/posts/${postId}/comments`, token, {
      method: 'POST',
      body: JSON.stringify(parentId ? { body, parentId } : { body }),
    });
    expect(res.status, `POST comment ${body}`).toBe(201);
    return (await res.json()) as FeedComment;
  };

  const noticesFor = (rows: NoticeRow[], userId: string) =>
    rows.filter((row) => row.kind === 'feed.post_commented' && row.user_id === userId);

  const PUSH_ENDPOINT = `https://push.fake.test/${IDENTITY_PREFIX}-helena`;
  const ALVARO_PUSH_ENDPOINT = `https://push.fake.test/${IDENTITY_PREFIX}-alvaro`;

  const subscribeDevice = async (token: string, endpoint: string): Promise<void> => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const res = await request('/v1/notifications/push-subscriptions', token, {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        keys: {
          p256dh: ecdh.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
        userAgent: 'vitest',
      }),
    });
    expect(res.status).toBeLessThan(300);
  };

  beforeAll(async () => {
    // Helena and Alvaro each have a live device, so "a push job exists" means "that person was
    // chosen" (the kernel pushes only to users with a subscription). Alvaro's is what makes the
    // WR-02 reply cases (7 to 9) able to prove "no push" rather than "nothing to push to".
    await subscribeDevice(tokens.helena, PUSH_ENDPOINT);
    await subscribeDevice(tokens.alvaro, ALVARO_PUSH_ENDPOINT);
  });

  afterAll(async () => {
    await adminSql`delete from public.push_subscriptions where endpoint in (${PUSH_ENDPOINT}, ${ALVARO_PUSH_ENDPOINT})`;
  });

  const closeWaitingJobs = () =>
    adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'
         and data->>'tenantId' = ${labTenantId}`;

  it('1. D-477: a first-level comment on a member post is ONE in-app row and ONE queued push for its author', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post que recebe comentario`);
    const comment = await commentOn(tokens.alvaro, post.id, 'Que legal isso, parabens');
    await runNotificationJobs(labTenantId);

    const rows = await rowsAbout(post.id);
    const notices = noticesFor(rows, userIds.helena);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      object_id: comment.id,
      actor_user_id: userIds.alvaro,
      dedupe_key: `feed.post_commented:${comment.id}`,
    });
    expect(notices[0]?.payload).toEqual({
      postId: post.id,
      commentId: comment.id,
      excerpt: 'Que legal isso, parabens',
    });
    // The commenter is told nothing, and nobody else is.
    expect(rows.filter((row) => row.kind === 'feed.post_commented')).toHaveLength(1);

    const pushed = (await pushSendJobsOf(labTenantId)).filter(
      (job) => job.data.dedupeKey === `feed.post_commented:${comment.id}`,
    );
    expect(pushed.flatMap((job) => job.data.userIds)).toEqual([userIds.helena]);
    expect(pushed[0]?.data.kind).toBe('feed.post_commented');
    expect(pushed[0]?.data.push.url).toBe(`/post/${post.id}?comentario=${comment.id}`);
    expect(String(pushed[0]?.data.push.body)).toContain('comentou na sua publicação');
  });

  it('2. nothing new: the author commenting on their own post, a like, a reply (beyond today’s) and a comment on an organization post', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post sem avisos extras`);
    await commentOn(tokens.helena, post.id, 'Comentario da propria autora');
    const first = await commentOn(tokens.alvaro, post.id, 'Comentario do Alvaro');
    await runNotificationJobs(labTenantId);
    expect(noticesFor(await rowsAbout(post.id), userIds.helena)).toHaveLength(1);

    // A like notifies nobody.
    const like = await request(`/v1/feed/posts/${post.id}/like`, tokens.alvaro, { method: 'POST' });
    expect(like.status).toBe(200);
    // A reply to Alvaro's root is the reply notice for Alvaro (today's behavior), never a second
    // post_commented for the post's author.
    await commentOn(tokens.helena, post.id, 'Resposta da autora', first.id);
    await runNotificationJobs(labTenantId);
    const rows = await rowsAbout(post.id);
    expect(noticesFor(rows, userIds.helena)).toHaveLength(1);
    expect(rows.filter((row) => row.kind === 'feed.post_commented')).toHaveLength(1);
    expect(rows.filter((row) => row.kind === 'feed.comment_replied')).toHaveLength(1);
    expect(rows.filter((row) => row.user_id === userIds.alvaro)).toHaveLength(1);

    // A comment on the ORGANIZATION's post adds nothing (today's behavior).
    const org = await publish(tokens.labAdmin, `${PREFIX}aviso sem aviso extra`);
    await commentOn(tokens.alvaro, org.id, 'Comentario no aviso');
    await runNotificationJobs(labTenantId);
    expect((await rowsAbout(org.id)).filter((row) => row.kind === 'feed.post_commented')).toEqual(
      [],
    );
  });

  it('3. T-09-25: deleting the comment blanks its notice to the removed marker; the post’s other notices stay', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post com comentario apagado`);
    const gone = await commentOn(tokens.alvaro, post.id, 'Comentario que vai sumir');
    const stays = await commentOn(tokens.alvaro, post.id, 'Comentario que fica');
    await runNotificationJobs(labTenantId);
    expect(noticesFor(await rowsAbout(post.id), userIds.helena)).toHaveLength(2);

    const res = await request(`/v1/feed/comments/${gone.id}`, tokens.alvaro, { method: 'DELETE' });
    expect(res.status).toBe(200);
    await runNotificationJobs(labTenantId);
    const rows = noticesFor(await rowsAbout(post.id), userIds.helena);
    expect(rows.find((row) => row.object_id === gone.id)?.payload).toEqual({ removed: true });
    expect(rows.find((row) => row.object_id === stays.id)?.payload).toEqual({
      postId: post.id,
      commentId: stays.id,
      excerpt: 'Comentario que fica',
    });
  });

  it('4. T-09-25: a moderator removing the post blanks every notice about it, and tells nobody', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post removido com avisos`);
    await commentOn(tokens.alvaro, post.id, 'Comentario antes da remocao');
    await runNotificationJobs(labTenantId);
    const before = await rowsAbout(post.id);
    expect(noticesFor(before, userIds.helena)).toHaveLength(1);

    expect((await remove(tokens.labAdmin, post.id)).status).toBe(200);
    await runNotificationJobs(labTenantId);
    const after = await rowsAbout(post.id);
    expect(after).toHaveLength(before.length);
    for (const row of after) expect(row.payload).toEqual({ removed: true });
  });

  it('5. social off at fan-out time produces no row (the gate is read in the worker lane)', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post com social desligado`);
    await commentOn(tokens.alvaro, post.id, 'Comentario antes de desligar');
    // Switch `social` off BEFORE the worker runs, then back on.
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    try {
      await runNotificationJobs(labTenantId);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    }
    expect(noticesFor(await rowsAbout(post.id), userIds.helena)).toEqual([]);
  });

  it('6. D-476 re-asserted: publishing a member post notifies nobody, followers included', async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post que ninguem recebe aviso`);
    await runNotificationJobs(labTenantId);
    expect(await rowsAbout(post.id)).toEqual([]);
  });

  /* ── 09-15 (WR-02, SOCIAL-06): a reply notice must not leak a followers-only thread ─────────────── */

  const repliesFor = (rows: NoticeRow[], userId: string) =>
    rows.filter((row) => row.kind === 'feed.comment_replied' && row.user_id === userId);

  /** The queued push jobs of ONE reply notice, by its dedupe key (the sink's own key for the reply). */
  const pushesOfReply = async (replyId: string) =>
    (await pushSendJobsOf(labTenantId)).filter(
      (job) => job.data.dedupeKey === `feed.comment_replied:${replyId}`,
    );

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

  it("7. SOCIAL-06 / WR-02: a reply to an ex-follower's comment yields no bell row and no push; the follower's reply still does", async () => {
    await closeWaitingJobs();
    const post = await publish(tokens.helena, `${PREFIX}post com ex-seguidor`);
    const root = await commentOn(tokens.alvaro, post.id, 'Comentario do Alvaro, seguidor');

    // Positive control: Alvaro follows Helena, so her reply reaches him in the bell and on his device.
    const first = await commentOn(tokens.helena, post.id, 'Resposta 1 para o seguidor', root.id);
    await runNotificationJobs(labTenantId);
    expect(repliesFor(await rowsAbout(post.id), userIds.alvaro)).toHaveLength(1);
    const firstPush = await pushesOfReply(first.id);
    expect(firstPush.flatMap((job) => job.data.userIds)).toEqual([userIds.alvaro]);

    try {
      // The ex-follower: the follow row is gone when the next reply fans out.
      await unfollow(userIds.alvaro, userIds.helena);
      const second = await commentOn(tokens.helena, post.id, 'Resposta 2 para o ex-seguidor', root.id);
      await runNotificationJobs(labTenantId);
      const afterUnfollow = repliesFor(await rowsAbout(post.id), userIds.alvaro);
      expect(afterUnfollow).toHaveLength(1);
      expect(afterUnfollow.some((row) => row.object_id === second.id)).toBe(false);
      expect(await pushesOfReply(second.id)).toEqual([]);
    } finally {
      await follow(userIds.alvaro, userIds.helena);
    }

    // Followed again: the reply reaches him once more.
    const third = await commentOn(tokens.helena, post.id, 'Resposta 3 para o seguidor de novo', root.id);
    await runNotificationJobs(labTenantId);
    const afterRefollow = repliesFor(await rowsAbout(post.id), userIds.alvaro);
    expect(afterRefollow).toHaveLength(2);
    expect(afterRefollow.some((row) => row.object_id === third.id)).toBe(true);
    expect((await pushesOfReply(third.id)).flatMap((job) => job.data.userIds)).toEqual([
      userIds.alvaro,
    ]);
  });
});
