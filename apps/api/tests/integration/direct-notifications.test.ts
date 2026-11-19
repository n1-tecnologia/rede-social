import { randomUUID } from 'node:crypto';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { chatNotificationSources } from '@rede-social/module-chat/server';
import {
  fakePushOutbox,
  notificationsFanoutJob,
  notificationsSystemCtx,
  resetFakePushOutbox,
} from '@rede-social/module-notifications/server';
import { socialNotificationSources } from '@rede-social/module-social/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { caseKit, post, removeThrowaways, request, throwawayMember } from './chat-case-fixtures';
import {
  blockUser,
  type DirectMember,
  directMember,
  removeDirectRows,
  requestOn,
  resetDirectLimiters,
  sendDirect,
  setModule,
  sharedDirectIdentity,
  withDirectModules,
} from './direct-fixtures';
import {
  adminSql,
  notificationJobsOf,
  pushSendJobsOf,
  runNotificationJobs,
  runPushSendJobs,
} from './setup';

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

/* -- the direct message push (Phase 11 plan 13, CHAT-06; D-728, D-860; T-11-08, T-11-02, T-11-01) ------------------------- */

type SendBody = { conversationId: string; message: { id: string; seq: number } };

const HEX32 = /^[0-9a-f]{32}$/;
const MESSAGE_KIND = 'chat.direct_message';

/** The member's device, with an endpoint the test can find again in the fake outbox. */
async function addNamedDevice(userId: string, label: string): Promise<string> {
  const endpoint = `https://push.fake.test/dirnotif/${label}-${randomUUID()}`;
  await adminSql`
    insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
    values (${demoTenantId}::uuid, ${userId}::uuid, ${endpoint}, 'k', 'a')`;
  return endpoint;
}

/** A writer with a name and a recipient with a device; the writer also has a device to prove they are never pushed. */
async function messagePair(label: string): Promise<{
  a: DirectMember;
  b: DirectMember;
  endpointA: string;
  endpointB: string;
}> {
  const a = await directMember(`${label}a`, { displayName: `Marina ${label}` });
  const b = await directMember(`${label}b`, { displayName: `Bruno ${label}` });
  return {
    a,
    b,
    endpointA: await addNamedDevice(a.userId, `${label}-a`),
    endpointB: await addNamedDevice(b.userId, `${label}-b`),
  };
}

async function writeTo(from: DirectMember, to: DirectMember, body: string): Promise<SendBody> {
  const res = await sendDirect(from, to.membershipId, body);
  expect(res.status).toBe(201);
  return (await res.json()) as SendBody;
}

/** The push-send jobs of a message (by its dedupe key), whoever they name. */
async function messageJobs(messageId: string) {
  return (await pushSendJobsOf(demoTenantId)).filter(
    (job) => job.data.dedupeKey === `${MESSAGE_KIND}:${messageId}`,
  );
}

/** Plays the fan-out of one `chat.message_sent` event through the real handler (as the worker does). */
async function fanOut(event: {
  conversationId: string;
  messageId: string;
  seq: number;
  authorUserId: string;
  tenantId?: string;
}): Promise<void> {
  const { tenantId = demoTenantId, ...rest } = event;
  await notificationsFanoutJob.handler({
    event: 'chat.message_sent',
    tenantId,
    payload: { tenantId, authorSide: 'member', ...rest },
    sinkAt: new Date().toISOString(),
  });
}

async function bellCount(userId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.notifications
     where user_id = ${userId}::uuid and kind like 'chat.%'`;
  return row?.n ?? -1;
}

describe('direct message push', () => {
  let restoreChat: () => Promise<void> = async () => {};
  const assetIds: string[] = [];

  beforeAll(async () => {
    restoreChat = await withDirectModules('demo', ['chat']);
  });

  beforeEach(async () => {
    resetDirectLimiters();
    await closeWaitingJobs();
    resetFakePushOutbox();
  });

  afterAll(async () => {
    if (assetIds.length > 0) {
      await adminSql`delete from public.chat_messages where media_asset_id = any(${assetIds}::uuid[])`;
      await adminSql`delete from public.media_assets where id = any(${assetIds}::uuid[])`;
    }
    await closeWaitingJobs();
    await restoreChat();
  });

  it("1. the path: A writes, B gets exactly ONE push titled with A's name, no bell row appears and A gets nothing", async () => {
    const { a, b, endpointA, endpointB } = await messagePair('m1');
    const sent = await writeTo(a, b, 'Oi Bruno, tudo bem? Vamos marcar aquele café?');
    expect(await runNotificationJobs(demoTenantId)).toBeGreaterThanOrEqual(1);

    const jobs = await messageJobs(sent.message.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.kind).toBe(MESSAGE_KIND);
    expect(jobs[0]?.data.userIds).toEqual([b.userId]);
    const tag = sent.conversationId.replaceAll('-', '');
    expect(tag).toMatch(HEX32);
    expect(jobs[0]?.data.push).toMatchObject({
      titleText: a.displayName,
      body: 'Oi Bruno, tudo bem? Vamos marcar aquele café?',
      url: `/conversas/${sent.conversationId}`,
      tag,
      topic: tag,
      renotify: true,
      urgency: 'high',
      ttlSeconds: 259_200,
    });

    // Push only: no bell row for either side, and the writer is told nothing.
    expect(await bellCount(b.userId)).toBe(0);
    expect(await bellCount(a.userId)).toBe(0);
    expect(
      (await pushSendJobsOf(demoTenantId)).some((job) => job.data.userIds.includes(a.userId)),
    ).toBe(false);

    // The device sees the writer's name as the title and the message start as the body.
    await runPushSendJobs(demoTenantId);
    const toB = fakePushOutbox().find((out) => out.endpoint === endpointB);
    expect(toB).toBeDefined();
    expect(JSON.parse(toB?.payload ?? '{}')).toMatchObject({
      title: a.displayName,
      body: 'Oi Bruno, tudo bem? Vamos marcar aquele café?',
      url: `/conversas/${sent.conversationId}`,
      tag,
      renotify: true,
    });
    expect(fakePushOutbox().some((out) => out.endpoint === endpointA)).toBe(false);
  });

  it('2. one banner per conversation: the second message carries the SAME tag, another conversation another tag', async () => {
    const { a, b } = await messagePair('m2');
    const c = await directMember('m2c', { displayName: 'Carla m2' });
    const first = await writeTo(a, b, 'primeira');
    const second = await writeTo(a, b, 'segunda');
    const other = await writeTo(c, b, 'outra conversa');
    expect(second.conversationId).toBe(first.conversationId);
    expect(other.conversationId).not.toBe(first.conversationId);
    await runNotificationJobs(demoTenantId);

    const tagOf = async (messageId: string) => {
      const jobs = await messageJobs(messageId);
      expect(jobs).toHaveLength(1);
      return ((jobs[0]?.data.push ?? {}) as { tag: string }).tag;
    };
    const t1 = await tagOf(first.message.id);
    const t2 = await tagOf(second.message.id);
    const t3 = await tagOf(other.message.id);
    expect(t1).toBe(t2);
    expect(t1).toMatch(HEX32);
    expect(t3).not.toBe(t1);
    expect(t3).toMatch(HEX32);
  });

  it('3. voice: a 42 second recording pushes "Mensagem de voz · 0:42" and a retired asset pushes nothing', async () => {
    const { a, b } = await messagePair('m3');
    const text = await writeTo(a, b, 'texto antes');
    await closeWaitingJobs();
    const { ids } = await caseKit();

    const voiceMessage = async (): Promise<{ id: string; assetId: string }> => {
      const [asset] = await adminSql<{ id: string }[]>`
        insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, ready_at)
        values (${ids.demo}::uuid, ${a.userId}::uuid, 'audio', 'voice', 'ready', 'audio/mp4', 70, 42, now())
        returning id::text as id`;
      if (!asset) throw new Error('fixture asset');
      assetIds.push(asset.id);
      const [message] = await adminSql<{ id: string; seq: number }[]>`
        insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
        values (${ids.demo}::uuid, ${text.conversationId}::uuid, ${a.userId}::uuid, 'member', null, ${asset.id}::uuid, 42)
        returning id::text as id, seq::int as seq`;
      if (!message) throw new Error('fixture message');
      return { id: message.id, assetId: asset.id };
    };

    const live = await voiceMessage();
    await fanOut({
      conversationId: text.conversationId,
      messageId: live.id,
      seq: 2,
      authorUserId: a.userId,
    });
    const liveJobs = await messageJobs(live.id);
    expect(liveJobs).toHaveLength(1);
    expect(liveJobs[0]?.data.push).toMatchObject({
      titleText: a.displayName,
      body: 'Mensagem de voz · 0:42',
    });

    // The same event once the asset was retired: nothing is pushed and no length leaks (D-868).
    const gone = await voiceMessage();
    await adminSql`update public.media_assets set status = 'deleted', deleted_at = now() where id = ${gone.assetId}::uuid`;
    await fanOut({
      conversationId: text.conversationId,
      messageId: gone.id,
      seq: 3,
      authorUserId: a.userId,
    });
    expect(await messageJobs(gone.id)).toHaveLength(0);
  });

  it('4a. a block between A and B, in either direction, after the event produces no job', async () => {
    const first = await messagePair('m4a');
    const sentFirst = await writeTo(first.a, first.b, 'antes do bloqueio');
    expect((await blockUser(first.b.token, first.a.userId)).status).toBeLessThan(300);
    await runNotificationJobs(demoTenantId);
    expect(await messageJobs(sentFirst.message.id)).toHaveLength(0);

    const second = await messagePair('m4b');
    const sentSecond = await writeTo(second.a, second.b, 'antes do bloqueio');
    expect((await blockUser(second.a.token, second.b.userId)).status).toBeLessThan(300);
    await runNotificationJobs(demoTenantId);
    expect(await messageJobs(sentSecond.message.id)).toHaveLength(0);
  });

  it('4b. social turned off between the send and the fan-out produces no job', async () => {
    const { a, b } = await messagePair('m4c');
    const sent = await writeTo(a, b, 'social vai desligar');
    const restore = await setModule('demo', 'social', false);
    try {
      await runNotificationJobs(demoTenantId);
    } finally {
      await restore();
    }
    expect(await messageJobs(sent.message.id)).toHaveLength(0);
  });

  it('4c. a recipient who was administrator-blocked, removed or anonymised receives nothing', async () => {
    for (const [label, change] of [
      ['blocked', 'blocked_at = now()'],
      ['removed', 'deleted_at = now()'],
      [
        'anon',
        "deleted_at = now(), anonymised_at = now(), deletion_requested_at = now() - interval '31 days', deletion_due_at = now() - interval '1 day'",
      ],
    ] as const) {
      const { a, b } = await messagePair(`m4${label}`);
      const sent = await writeTo(a, b, `para ${label}`);
      await adminSql.unsafe(
        `update public.memberships set ${change} where id = '${b.membershipId}'::uuid`,
      );
      await runNotificationJobs(demoTenantId);
      expect(await messageJobs(sent.message.id), label).toHaveLength(0);
    }
  });

  it('4d. a stale event of a deleted message produces no job', async () => {
    const { a, b } = await messagePair('m4d');
    const sent = await writeTo(a, b, 'vou apagar');
    await adminSql`update public.chat_messages set deleted_at = now() where id = ${sent.message.id}::uuid`;
    await runNotificationJobs(demoTenantId);
    expect(await messageJobs(sent.message.id)).toHaveLength(0);
  });

  it('4e. an event of tenant A resolved in tenant B lane never reads the message (T-11-01)', async () => {
    const { a, b } = await messagePair('m4e');
    const sent = await writeTo(a, b, 'so no tenant demo');
    await closeWaitingJobs();
    const source = chatNotificationSources.find((entry) => entry.event === 'chat.message_sent');
    if (!source) throw new Error('chat declares no chat.message_sent source');
    const payload = {
      tenantId: labTenantId,
      conversationId: sent.conversationId,
      messageId: sent.message.id,
      seq: sent.message.seq,
      authorUserId: a.userId,
      authorSide: 'member' as const,
    };
    const inLab = await withTenantTx(notificationsSystemCtx(labTenantId), (tx) =>
      source.resolve(tx, payload, { sinkAt: new Date().toISOString() }),
    );
    expect(inLab).toEqual([]);
    // Positive control: the same event in its own tenant answers one intent.
    const inDemo = await withTenantTx(notificationsSystemCtx(demoTenantId), (tx) =>
      source.resolve(
        tx,
        { ...payload, tenantId: demoTenantId },
        { sinkAt: new Date().toISOString() },
      ),
    );
    expect(inDemo).toHaveLength(1);
  });

  it('4f. the support reply and the team pushes keep their shipped shapes, with no literal title', async () => {
    const { tokens, ids } = await caseKit();
    const member = await throwawayMember('m4f');
    const memberEndpoint = await addNamedDevice(member.id, 'm4f-member');
    await adminSql`
      insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
      values (${demoTenantId}::uuid, ${ids.demoSupport}::uuid, ${`https://push.fake.test/dirnotif/m4f-staff-${randomUUID()}`}, 'k', 'a')`;
    await closeWaitingJobs();

    const opened = await post('/v1/chat/support/messages', member.token, {
      body: 'Preciso de ajuda',
    });
    expect(opened.status).toBe(201);
    const first = (await opened.json()) as SendBody;
    await runNotificationJobs(demoTenantId);
    const toTeam = (await pushSendJobsOf(demoTenantId)).filter(
      (job) => job.data.dedupeKey === `chat.case_new:${first.message.id}`,
    );
    expect(toTeam).toHaveLength(1);
    expect(toTeam[0]?.data.push).toMatchObject({ title: 'tenant' });
    expect(toTeam[0]?.data.push).not.toHaveProperty('titleText');

    await closeWaitingJobs();
    const replied = await post(
      `/v1/chat/conversations/${first.conversationId}/messages`,
      tokens.demoSupport,
      { body: 'Resposta da equipe' },
    );
    expect(replied.status).toBe(201);
    const reply = (await replied.json()) as SendBody;
    await runNotificationJobs(demoTenantId);
    const toMember = (await pushSendJobsOf(demoTenantId)).filter(
      (job) => job.data.dedupeKey === `chat.support_reply:${reply.message.id}`,
    );
    expect(toMember).toHaveLength(1);
    expect(toMember[0]?.data.userIds).toEqual([member.id]);
    expect(toMember[0]?.data.push).toMatchObject({ title: 'team', url: '/suporte' });
    expect(toMember[0]?.data.push).not.toHaveProperty('titleText');
    expect(memberEndpoint).toContain('m4f-member');
    // Neither support push is the direct kind.
    expect(await messageJobs(first.message.id)).toHaveLength(0);
    expect(await messageJobs(reply.message.id)).toHaveLength(0);
  });
});
