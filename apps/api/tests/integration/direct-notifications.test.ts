import { randomUUID } from 'node:crypto';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { notificationsSystemCtx } from '@rede-social/module-notifications/server';
import { socialNotificationSources } from '@rede-social/module-social/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  blockUser,
  type DirectMember,
  directMember,
  removeDirectRows,
  requestOn,
  setModule,
  sharedDirectIdentity,
  withDirectModules,
} from './direct-fixtures';
import { adminSql, notificationJobsOf, pushSendJobsOf, runNotificationJobs } from './setup';

/**
 * Phase 11 plan 11 (CHAT-06, CHAT-07; D-726, D-727; T-11-15, T-11-13, T-11-01): the notices of the direct-messages phase,
 * through the real fan-out against the live local stack. This file holds the FOLLOW notice ("começou a te seguir"); plan
 * 13 appends the message push beside it.
 *
 * FIXTURES. Throwaway members of the demo tenant with `social` and `notifications` switched on for the span (and
 * restored); the seeded members are never touched (a block through the API clears a follow). The fan-out is played
 * in-process with `runNotificationJobs`, exactly the worker's handler. Every row the file makes is swept before the users.
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const SHARED_PREFIX = 'dirnotif';

const startedAt = new Date();
let demoTenantId = '';
let labTenantId = '';
let restoreDemo: () => Promise<void> = async () => {};
let restoreLab: () => Promise<void> = async () => {};

/** Waiting jobs other files enqueued would write rows here: closed, not run. */
async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'
       and data->>'tenantId' in (${demoTenantId}, ${labTenantId})`;
}

beforeAll(async () => {
  const { ids } = await caseKit();
  demoTenantId = ids.demo;
  labTenantId = ids.lab;
  await removeDirectRows([SHARED_PREFIX]);
  restoreDemo = await withDirectModules('demo', ['social', 'notifications']);
  restoreLab = await withDirectModules('lab', ['notifications']);
  await closeWaitingJobs();
});

afterAll(async () => {
  await closeWaitingJobs();
  const ids = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users
     where (email like 'case-%@rede-demo.local' and created_at >= ${startedAt})
        or email like ${`${SHARED_PREFIX}-%`}`;
  const list = ids.map((row) => row.id);
  if (list.length > 0) {
    await adminSql`delete from public.notifications where user_id = any(${list}::uuid[])`;
    await adminSql`delete from public.push_subscriptions where user_id = any(${list}::uuid[])`;
    await adminSql`delete from public.feed_comments where author_user_id = any(${list}::uuid[])`;
    await adminSql`delete from public.feed_posts where author_user_id = any(${list}::uuid[])`;
  }
  await removeDirectRows([SHARED_PREFIX]);
  await removeThrowaways();
  await restoreLab();
  await restoreDemo();
});

const follow = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/follows/${membershipId}`, from.token, { method: 'PUT' });
const unfollow = (from: { token: string }, membershipId: string) =>
  request(`/v1/social/follows/${membershipId}`, from.token, { method: 'DELETE' });

type Bell = {
  kind: string;
  dedupe_key: string;
  actor_user_id: string | null;
  subject_type: string;
  subject_id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
};

/** The "começou a te seguir" rows of one user (every tenant), as the table owner reads them. */
const bellOf = (userId: string) =>
  adminSql<Bell[]>`
    select kind, dedupe_key, actor_user_id::text as actor_user_id, subject_type,
           subject_id::text as subject_id, tenant_id::text as tenant_id, payload
      from public.notifications
     where user_id = ${userId}::uuid and kind = 'social.followed'
     order by created_at, id`;

/** Fan-out jobs for `social.followed` still waiting for the worker. */
async function waitingFollowJobs(tenantId = demoTenantId): Promise<number> {
  return (await notificationJobsOf(tenantId)).filter(
    (job) =>
      job.state === 'created' && (job.data as { event?: string }).event === 'social.followed',
  ).length;
}

/** Push jobs that name this user (the kernel pushes only to a user with a device and a push channel). */
async function pushJobsFor(userId: string, tenantId = demoTenantId): Promise<number> {
  return (await pushSendJobsOf(tenantId)).filter((job) => job.data.userIds.includes(userId)).length;
}

async function addDevice(userId: string, tenantId = demoTenantId): Promise<void> {
  await adminSql`
    insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
    values (${tenantId}::uuid, ${userId}::uuid, ${`https://push.fake.test/dirnotif/${randomUUID()}`}, 'k', 'a')`;
}

async function pair(label: string): Promise<{ a: DirectMember; b: DirectMember }> {
  const a = await directMember(`${label}a`, { displayName: `Seguidor ${label}` });
  const b = await directMember(`${label}b`, { displayName: `Seguido ${label}` });
  await addDevice(b.userId);
  return { a, b };
}

describe('follow notice', () => {
  it('1. a follow creates ONE bell row for the followee, the follower as actor, an id-only payload and NO push', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n1');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    expect(await runNotificationJobs(demoTenantId)).toBeGreaterThanOrEqual(1);

    const rows = await bellOf(b.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'social.followed',
      dedupe_key: `social.followed:${a.userId}:${b.userId}`,
      actor_user_id: a.userId,
      subject_type: 'membership',
      subject_id: a.membershipId,
      tenant_id: demoTenantId,
      payload: { membershipId: a.membershipId },
    });
    // The payload is an id and nothing else: no name, no excerpt.
    expect(Object.keys(rows[0]?.payload ?? {})).toEqual(['membershipId']);
    // The follower is told nothing, and the followee (who HAS a device) is never pushed.
    expect(await bellOf(a.userId)).toHaveLength(0);
    expect(await pushJobsFor(b.userId)).toBe(0);
  });

  it('2. follow, unfollow, follow again leaves ONE row; the repeat emits again but the dedupe key holds (T-11-13)', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n2');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    await runNotificationJobs(demoTenantId);
    expect(await bellOf(b.userId)).toHaveLength(1);

    expect((await unfollow(a, b.membershipId)).status).toBe(200);
    // Undoing the follow never retracts the row.
    expect(await bellOf(b.userId)).toHaveLength(1);

    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    await runNotificationJobs(demoTenantId);
    const rows = await bellOf(b.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupe_key).toBe(`social.followed:${a.userId}:${b.userId}`);
    expect(await pushJobsFor(b.userId)).toBe(0);
  });

  it('3. a repeat PUT emits no second event: one waiting job, one row', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n3');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    await runNotificationJobs(demoTenantId);
    expect(await bellOf(b.userId)).toHaveLength(1);
  });

  it('4. idempotency (CHAT-06): ten parallel PUTs leave one follow, answer 200 each, emit once and leave one row', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n4');
    const answers = await Promise.all(Array.from({ length: 10 }, () => follow(a, b.membershipId)));
    expect(answers.map((res) => res.status)).toEqual(Array(10).fill(200));
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.social_follows
       where follower_user_id = ${a.userId}::uuid and followee_user_id = ${b.userId}::uuid`;
    expect(rows?.n).toBe(1);
    expect(await waitingFollowJobs()).toBe(1);
    await runNotificationJobs(demoTenantId);
    expect(await bellOf(b.userId)).toHaveLength(1);
  });

  it('5. a pair blocked between the follow and the fan-out produces no row (T-11-15)', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n5');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    // The followee blocks the follower BEFORE the worker runs.
    expect((await blockUser(b.token, a.userId)).status).toBeLessThan(300);
    await runNotificationJobs(demoTenantId);
    expect(await bellOf(b.userId)).toHaveLength(0);
    expect(await pushJobsFor(b.userId)).toBe(0);
  });

  it('6. a block that stands BEFORE the follow: the follow is the plain 404 and nothing is enqueued', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n6');
    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);
    expect((await follow(a, b.membershipId)).status).toBe(404);
    expect((await follow(b, a.membershipId)).status).toBe(404);
    expect(await waitingFollowJobs()).toBe(0);
    expect(await bellOf(b.userId)).toHaveLength(0);
    expect(await bellOf(a.userId)).toHaveLength(0);
  });

  it('7. social turned off between the follow and the fan-out produces no row', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n7');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    expect(await waitingFollowJobs()).toBe(1);
    const restore = await setModule('demo', 'social', false);
    try {
      await runNotificationJobs(demoTenantId);
    } finally {
      await restore();
    }
    expect(await bellOf(b.userId)).toHaveLength(0);
  });

  it('8. a follower removed before the fan-out produces no row', async () => {
    await closeWaitingJobs();
    const { a, b } = await pair('n8');
    expect((await follow(a, b.membershipId)).status).toBe(200);
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${a.membershipId}::uuid`;
    await runNotificationJobs(demoTenantId);
    expect(await bellOf(b.userId)).toHaveLength(0);
  });

  it('9. a staff followee and a staff follower produce no intent (the source is member to member)', async () => {
    const { a } = await pair('n9');
    const { ids } = await caseKit();
    const source = socialNotificationSources[0];
    if (!source) throw new Error('social declares no notification source');
    const lane = notificationsSystemCtx(demoTenantId);
    const resolve = (followerUserId: string, followeeUserId: string) =>
      withTenantTx(lane, (tx) =>
        source.resolve(
          tx,
          { tenantId: demoTenantId, followerUserId, followeeUserId },
          { sinkAt: new Date().toISOString() },
        ),
      );
    // Positive control: two live members answer one intent.
    const { b: other } = await pair('n9b');
    expect(await resolve(a.userId, other.userId)).toHaveLength(1);
    // The staff on either side: nothing.
    expect(await resolve(a.userId, ids.demoAdmin)).toEqual([]);
    expect(await resolve(ids.demoAdmin, a.userId)).toEqual([]);
    expect(await resolve(a.userId, ids.demoSupport)).toEqual([]);
    // An unknown follower: nothing.
    expect(await resolve(randomUUID(), a.userId)).toEqual([]);
  });

  it('10. D-726: a member post notifies nobody, and a first-level comment on it still tells its author (D-477)', async () => {
    await closeWaitingJobs();
    const author = await directMember('n10a', { displayName: 'Autora 10' });
    const reader = await directMember('n10b', { displayName: 'Leitor 10' });
    const stranger = await directMember('n10c', { displayName: 'Estranho 10' });
    // The reader follows the author, so a "followers see the post" notice would reach them if one existed.
    expect((await follow(reader, author.membershipId)).status).toBe(200);
    await runNotificationJobs(demoTenantId);
    await closeWaitingJobs();

    const posted = await request('/v1/feed/posts', author.token, {
      method: 'POST',
      body: JSON.stringify({ caption: 'Teste 11-11 post de membro' }),
    });
    expect(posted.status).toBe(201);
    const post = (await posted.json()) as { id: string };
    await runNotificationJobs(demoTenantId);
    const about = await adminSql<{ user_id: string; kind: string }[]>`
      select user_id::text as user_id, kind from public.notifications
       where tenant_id = ${demoTenantId}::uuid and subject_id = ${post.id}::uuid`;
    expect(about).toEqual([]);
    for (const member of [reader, stranger, author]) {
      const own = await adminSql<{ kind: string }[]>`
        select kind from public.notifications
         where user_id = ${member.userId}::uuid and kind in ('feed.post', 'feed.reel', 'feed.community_post')`;
      expect(own).toEqual([]);
    }

    const commented = await request(`/v1/feed/posts/${post.id}/comments`, reader.token, {
      method: 'POST',
      body: JSON.stringify({ body: 'Que legal' }),
    });
    expect(commented.status).toBe(201);
    await runNotificationJobs(demoTenantId);
    const notices = await adminSql<{ user_id: string; kind: string }[]>`
      select user_id::text as user_id, kind from public.notifications
       where tenant_id = ${demoTenantId}::uuid and subject_id = ${post.id}::uuid`;
    expect(notices).toEqual([{ user_id: author.userId, kind: 'feed.post_commented' }]);
  });
});

describe('follow notice cross-tenant', () => {
  it('a block in the demo tenant stops the demo notice and leaves the same two users lab notice alone (T-11-01)', async () => {
    await closeWaitingJobs();
    const a = await sharedDirectIdentity(`${SHARED_PREFIX}-a`);
    const b = await sharedDirectIdentity(`${SHARED_PREFIX}-b`);

    // Demo: follow, then the followee blocks before the worker runs. Lab: a plain follow.
    expect((await follow({ token: a.demo.token }, b.demo.membershipId)).status).toBe(200);
    expect((await blockUser(b.demo.token, a.userId)).status).toBeLessThan(300);
    expect(
      (
        await requestOn('lab', `/v1/social/follows/${b.lab.membershipId}`, a.lab.token, {
          method: 'PUT',
        })
      ).status,
    ).toBe(200);

    await runNotificationJobs(demoTenantId);
    await runNotificationJobs(labTenantId);

    const rows = await bellOf(b.userId);
    // The lab row is the positive control; the demo row never existed, and nothing crossed over.
    expect(rows.map((row) => row.tenant_id)).toEqual([labTenantId]);
    expect(rows[0]?.subject_id).toBe(a.lab.membershipId);
    expect(rows[0]?.payload).toEqual({ membershipId: a.lab.membershipId });
  });
});
