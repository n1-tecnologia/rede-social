import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { type Counters, resolveBranding } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { type PushPayload, pushPayloadSchema } from '@rede-social/module-notifications/contracts';
import {
  fakePushOutbox,
  notificationsFanoutJob,
  pushSendJob,
  resetFakePushOutbox,
} from '@rede-social/module-notifications/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  notificationJobsOf,
  pushSendJobsOf,
  removeIdentitiesByPrefix,
  runNotificationJobs,
  runPushSendJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * Web Push, server half (07-06, NOTIF-03 / NOTIF-04 / ROADMAP Phase 7 SC 2 and SC 4), end to end on the
 * FAKE transport (`PUSH_TRANSPORT=fake`, pinned by `vitest.config.ts`): a member saves a device through
 * the API, the admin publishes, the fan-out's push channel enqueues `notifications.push-send`, and the
 * test plays the worker (`runPushSendJobs`). The fake transport records every send in memory and answers
 * the status a `/status/<code>` endpoint path asks for, so nothing ever leaves the machine.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order). Both hooks sweep this file's
 * own posts by caption prefix, the demo tenant's notification rows and push subscriptions, and close
 * any fan-out or push-send job other files left waiting, so every count here is exact. Each test resets
 * the fake outbox.
 */

const CAPTION = 'Push de teste';
const FAKE = 'https://push.fake.test';

const tokens = { admin: '', member: '', second: '' };
const ids = { demo: '', member: '', second: '' };

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': HOSTS.demo,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

/** A browser-shaped key pair: a real uncompressed P-256 point and 16 random auth bytes, base64url. */
function deviceKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

const subscribe = (token: string, endpoint: string, keys = deviceKeys()) =>
  request('/v1/notifications/push-subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({ endpoint, keys, userAgent: 'vitest' }),
  });

const unsubscribe = (token: string, endpoint: string) =>
  request('/v1/notifications/push-subscriptions', token, {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });

async function publish(label: string): Promise<string> {
  const res = await request('/v1/feed/posts', tokens.admin, {
    method: 'POST',
    body: JSON.stringify({ caption: `${CAPTION} ${label}` }),
  });
  expect(res.status, 'post published').toBe(201);
  return ((await res.json()) as { id: string }).id;
}

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  failure_count: number;
  last_success_at: Date | null;
};

async function subscriptionsOf(userId: string): Promise<SubscriptionRow[]> {
  return adminSql<SubscriptionRow[]>`
    select id::text as id, user_id::text as user_id, endpoint, failure_count, last_success_at
      from public.push_subscriptions
     where tenant_id = ${ids.demo}::uuid and user_id = ${userId}::uuid
     order by created_at, id`;
}

async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
  await adminSql`delete from public.notifications where tenant_id = ${ids.demo}::uuid`;
  await adminSql`delete from public.feed_posts where caption like ${`${CAPTION}%`}`;
  await closeWaitingJobs();
}

const waitingPushJobs = async () =>
  (await pushSendJobsOf(ids.demo)).filter((job) => job.state === 'created');

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  ids.demo = tenant?.id ?? '';
  const [member] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = 'member@rede-demo.local'`;
  ids.member = member?.id ?? '';
  const [second] = await adminSql<{ email: string; id: string }[]>`
    select u.email, u.id::text as id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.demo}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and u.email <> 'member@rede-demo.local' and u.email not like '%removid%'
     order by u.email limit 1`;
  if (!second) throw new Error('the seed must provide a second demo member');
  ids.second = second.id;
  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.second = await signInAs(second.email, SEED_PASSWORD);
  await sweep();
});

afterAll(async () => {
  await adminSql`
    update public.memberships set blocked_at = null
     where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
  await sweep();
});

beforeEach(() => {
  resetFakePushOutbox();
});

describe('push: NOTIF-03 end to end on the fake transport', () => {
  it('1. a subscribed member gets ONE branded, tagged push per post, with the badge of their counters', async () => {
    const endpoint = `${FAKE}/sub/${randomUUID()}`;
    expect((await subscribe(tokens.member, endpoint)).status).toBe(204);
    expect(await subscriptionsOf(ids.member)).toHaveLength(1);

    const postId = await publish('1');
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const jobs = await waitingPushJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.singleton_key).toBe(`push:feed.post:${postId}:0`);
    expect(jobs[0]?.data).toMatchObject({ kind: 'feed.post', attempt: 0, userIds: [ids.member] });
    expect(await runPushSendJobs(ids.demo)).toBe(1);

    const outbox = fakePushOutbox();
    expect(outbox).toHaveLength(1);
    const [sent] = outbox;
    expect(sent?.endpoint).toBe(endpoint);
    expect(sent?.opts).toEqual({ ttlSeconds: 86_400, urgency: 'normal', topic: 'feed-post' });

    const [tenant] = await adminSql<{ display_name: string; branding: unknown }[]>`
      select display_name, branding from public.tenants where id = ${ids.demo}::uuid`;
    const counters = (await (await request('/v1/me/counters', tokens.member)).json()) as Counters;
    const payload = pushPayloadSchema.parse(JSON.parse(sent?.payload ?? '{}'));
    expect(payload).toEqual<PushPayload>({
      v: 1,
      title: tenant?.display_name ?? '',
      body: `Novo post: ${CAPTION} 1`,
      icon: resolveBranding(tenant?.branding ?? {}).iconUrls?.i192 ?? '/icons/rede-social-192.png',
      url: `/post/${postId}`,
      tag: 'feed-post',
      renotify: false,
      badge: counters.unreadNotifications + counters.unreadConversations,
    });
    expect(payload.badge).toBeGreaterThanOrEqual(1);

    // 201 stamps the row.
    const [row] = await subscriptionsOf(ids.member);
    expect(row?.last_success_at).not.toBeNull();
    expect(row?.failure_count).toBe(0);

    // 3. The SAME fan-out, run again (a pg-boss retry), inserts no row, so it enqueues no push.
    const fanout = (await notificationJobsOf(ids.demo)).find(
      (job) => (job.data.payload as { postId?: string } | undefined)?.postId === postId,
    );
    expect(fanout?.state).toBe('completed');
    await notificationsFanoutJob.handler(
      fanout?.data as Parameters<typeof notificationsFanoutJob.handler>[0],
    );
    expect(await waitingPushJobs()).toHaveLength(0);
  });

  it('1b. 07 review B-WR-02: a push queued before its post was deleted is withdrawn, and the job keeps its body 5 minutes', async () => {
    const endpoint = `${FAKE}/sub/${randomUUID()}`;
    expect((await subscribe(tokens.member, endpoint)).status).toBe(204);
    const postId = await publish('1b apagado');
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const [queued] = await waitingPushJobs();
    expect(queued?.singleton_key).toBe(`push:feed.post:${postId}:0`);
    const [keep] = await adminSql<{ deletion_seconds: number; retention_seconds: number }[]>`
      select deletion_seconds,
             extract(epoch from (keep_until - created_on))::int as retention_seconds
        from pgboss.job_common where id = ${queued?.id ?? ''}::uuid`;
    expect(keep?.deletion_seconds).toBe(300);
    expect(keep?.retention_seconds).toBe(6 * 3600);

    // The author deletes the post before the worker sends; the retraction runs first.
    const removed = await request(`/v1/feed/posts/${postId}`, tokens.admin, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    expect(await runPushSendJobs(ids.demo)).toBe(1);
    expect(fakePushOutbox()).toHaveLength(0);
  });

  it('2. D-235: a like on the member’s comment enqueues no push, even with a device', async () => {
    const postId = await publish('2');
    await runNotificationJobs(ids.demo);
    await closeWaitingJobs();

    const commented = await request(`/v1/feed/posts/${postId}/comments`, tokens.member, {
      method: 'POST',
      body: JSON.stringify({ body: 'Comentário do membro' }),
    });
    expect(commented.status).toBe(201);
    const { id: commentId } = (await commented.json()) as { id: string };
    await runNotificationJobs(ids.demo);
    const before = (await pushSendJobsOf(ids.demo)).length;

    expect(
      (await request(`/v1/feed/comments/${commentId}/like`, tokens.second, { method: 'POST' }))
        .status,
    ).toBe(200);
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const liked = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid
         and kind = 'feed.comment_liked' and object_id = ${commentId}::uuid`;
    expect(liked[0]?.n, 'the like IS an in-app row').toBe(1);
    expect((await pushSendJobsOf(ids.demo)).length, 'and no push job').toBe(before);
    expect(await runPushSendJobs(ids.demo)).toBe(0);
    expect(fakePushOutbox()).toHaveLength(0);
  });

  it('4. 410 deletes the subscription, 503 is re-tried alone with backoff, a healthy sibling is never re-sent', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    const healthy = `${FAKE}/sub/${randomUUID()}`;
    const gone = `${FAKE}/status/410/${randomUUID()}`;
    const failing = `${FAKE}/status/503/${randomUUID()}`;
    for (const endpoint of [healthy, gone, failing]) {
      expect((await subscribe(tokens.member, endpoint)).status).toBe(204);
    }
    const failingId = (await subscriptionsOf(ids.member)).find(
      (row) => row.endpoint === failing,
    )?.id;

    await publish('4');
    await runNotificationJobs(ids.demo);
    expect(await runPushSendJobs(ids.demo)).toBe(1);
    expect(
      fakePushOutbox()
        .map((send) => send.endpoint)
        .sort(),
    ).toEqual([healthy, gone, failing].sort());

    const rows = await subscriptionsOf(ids.member);
    expect(rows.map((row) => row.endpoint).sort()).toEqual([healthy, failing].sort());
    expect(rows.find((row) => row.endpoint === healthy)?.last_success_at).not.toBeNull();
    expect(rows.find((row) => row.endpoint === failing)?.failure_count).toBe(1);

    // The re-try carries ONLY the failed subscription, attempt 1, 30 s later.
    let [retry] = await waitingPushJobs();
    expect(retry?.data.attempt).toBe(1);
    expect(retry?.data.subscriptionIds).toEqual([failingId]);
    expect(retry?.data.userIds).toEqual([ids.member]);
    const [{ now } = { now: new Date() }] = await adminSql<{ now: Date }[]>`select now() as now`;
    const delay = ((retry?.start_after.getTime() ?? 0) - now.getTime()) / 1000;
    expect(delay).toBeGreaterThan(20);
    expect(delay).toBeLessThanOrEqual(31);

    resetFakePushOutbox();
    expect(await runPushSendJobs(ids.demo)).toBe(1);
    expect(fakePushOutbox().map((send) => send.endpoint)).toEqual([failing]);
    [retry] = await waitingPushJobs();
    expect(retry?.data.attempt).toBe(2);

    // Attempts 2 and 3 fail too; after the third the subscription is dropped from the queue.
    expect(await runPushSendJobs(ids.demo)).toBe(1);
    [retry] = await waitingPushJobs();
    expect(retry?.data.attempt).toBe(3);
    expect(await runPushSendJobs(ids.demo)).toBe(1);
    expect(await waitingPushJobs()).toHaveLength(0);
    expect(
      (await subscriptionsOf(ids.member)).find((row) => row.endpoint === failing)?.failure_count,
    ).toBe(4);
    expect(fakePushOutbox().filter((send) => send.endpoint === healthy)).toHaveLength(0);
  });

  it('5. SC 4: a member blocked after subscribing loses their devices at the next push and gets nothing', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    expect((await subscribe(tokens.member, `${FAKE}/sub/${randomUUID()}`)).status).toBe(204);
    expect(await subscriptionsOf(ids.member)).toHaveLength(1);
    try {
      await adminSql`
        update public.memberships set blocked_at = now()
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
      await publish('5');
      await runNotificationJobs(ids.demo);
      expect(await subscriptionsOf(ids.member)).toHaveLength(0);
      expect(await waitingPushJobs()).toHaveLength(0);
      await runPushSendJobs(ids.demo);
      expect(fakePushOutbox()).toHaveLength(0);
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
    }
  });

  it('5b. a job whose listed user turned non-live deletes their devices and sends nothing', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    expect((await subscribe(tokens.member, `${FAKE}/sub/${randomUUID()}`)).status).toBe(204);
    const postId = await publish('5b');
    await runNotificationJobs(ids.demo);
    expect(await waitingPushJobs()).toHaveLength(1);
    try {
      await adminSql`
        update public.memberships set blocked_at = now()
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
      expect(await runPushSendJobs(ids.demo)).toBe(1);
      expect(fakePushOutbox()).toHaveLength(0);
      expect(await subscriptionsOf(ids.member)).toHaveLength(0);
      expect(postId).toBeTruthy();
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
    }
  });

  it('6. NOTIF-03 empty: recipients without a device produce no push job', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    await publish('6');
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    expect(await waitingPushJobs()).toHaveLength(0);
    expect(fakePushOutbox()).toHaveLength(0);
  });

  it('7. V5 input: http, an IP literal, an unlisted host and wrong key lengths are 400 with details.push', async () => {
    const refused = async (res: Response, reason: string) => {
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; details?: { push?: string } };
      };
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.push).toBe(reason);
    };
    await refused(
      await subscribe(tokens.member, `http://push.fake.test/sub/${randomUUID()}`),
      'endpoint_invalid',
    );
    await refused(
      await subscribe(tokens.member, `https://127.0.0.1/sub/${randomUUID()}`),
      'endpoint_invalid',
    );
    await refused(
      await subscribe(tokens.member, `https://push.example.com/sub/${randomUUID()}`),
      'endpoint_invalid',
    );
    await refused(await subscribe(tokens.member, 'not a url'), 'endpoint_invalid');
    const good = deviceKeys();
    await refused(
      await subscribe(tokens.member, `${FAKE}/sub/${randomUUID()}`, {
        ...good,
        p256dh: randomBytes(64).toString('base64url'),
      }),
      'keys_invalid',
    );
    await refused(
      await subscribe(tokens.member, `${FAKE}/sub/${randomUUID()}`, {
        ...good,
        auth: randomBytes(15).toString('base64url'),
      }),
      'keys_invalid',
    );
    // Positive control: the same keys on the fake host are accepted.
    expect((await subscribe(tokens.member, `${FAKE}/sub/${randomUUID()}`, good)).status).toBe(204);
  });

  it('8. device handoff: B saving A’s endpoint moves it to B, and A’s next push sends nothing', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    const endpoint = `${FAKE}/sub/${randomUUID()}`;
    expect((await subscribe(tokens.member, endpoint)).status).toBe(204);
    expect((await subscribe(tokens.second, endpoint)).status).toBe(204);
    const rows = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.push_subscriptions
       where tenant_id = ${ids.demo}::uuid and endpoint = ${endpoint}`;
    expect(rows).toEqual([{ user_id: ids.second }]);

    const job = (userIds: string[]) => ({
      tenantId: ids.demo,
      kind: 'feed.post',
      dedupeKey: `test07-06:${randomUUID()}`,
      userIds,
      push: {
        title: 'tenant' as const,
        body: 'Novo post: handoff',
        url: '/inicio',
        tag: 'feed-post',
        topic: 'feed-post',
        ttlSeconds: 86_400,
        urgency: 'normal' as const,
        renotify: false,
      },
      attempt: 0,
    });
    await pushSendJob.handler(job([ids.member]));
    expect(fakePushOutbox(), "A's push reaches nothing").toHaveLength(0);
    await pushSendJob.handler(job([ids.second]));
    expect(fakePushOutbox().map((send) => send.endpoint)).toEqual([endpoint]);
  });

  it('9. DELETE forgets the caller’s own device and is idempotent', async () => {
    await adminSql`delete from public.push_subscriptions where tenant_id = ${ids.demo}::uuid`;
    const endpoint = `${FAKE}/sub/${randomUUID()}`;
    expect((await subscribe(tokens.member, endpoint)).status).toBe(204);
    const other = `${FAKE}/sub/${randomUUID()}`;
    expect((await subscribe(tokens.second, other)).status).toBe(204);

    // Another member's endpoint: 204, and their row stays.
    expect((await unsubscribe(tokens.member, other)).status).toBe(204);
    expect(await subscriptionsOf(ids.second)).toHaveLength(1);

    expect((await unsubscribe(tokens.member, endpoint)).status).toBe(204);
    expect(await subscriptionsOf(ids.member)).toHaveLength(0);
    expect((await unsubscribe(tokens.member, endpoint)).status).toBe(204);
  });

  it('10. shared identity: a device saved on the demo lane is invisible to the lab lane, and the reverse (08.1-07, SC 5)', async () => {
    // S is `member` of rede-demo and `admin_tenant` of rede-lab, with ONE token. `push_subscriptions`
    // is unique per `(tenant_id, endpoint)` and owner-scoped in each lane, so a device S saves on one
    // host must never be used for, listed by, nor deletable from the other host. rede-lab has
    // `notifications` OFF in the seed: turned on here (S saves through the real route there) and
    // restored in `finally`. The identity carries the `sipu-` prefix and is swept before and after.
    const PREFIX = 'sipu';
    await removeIdentitiesByPrefix(PREFIX);
    const [lab] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-lab'`;
    const labId = lab?.id ?? '';
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${labId}::uuid and module_key = 'notifications'`;
    const created = await createSharedIdentity({
      prefix: `${PREFIX}-${Date.now()}`,
      memberships: [
        { host: 'demo', role: 'member', displayName: 'S em Demo' },
        { host: 'lab', role: 'admin_tenant', displayName: 'S no Lab' },
      ],
    });
    const token = await signInAs(created.email, created.password);
    const onHost = (method: 'POST' | 'DELETE', host: string, body: object) =>
      api.request('/v1/notifications/push-subscriptions', {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-tenant-host': host,
        },
        body: JSON.stringify(body),
      });
    const rowsOfS = () =>
      adminSql<{ tenant_id: string; endpoint: string }[]>`
        select tenant_id::text, endpoint from public.push_subscriptions
         where user_id = ${created.userId}::uuid order by tenant_id, endpoint`;
    const job = (tenantId: string) => ({
      tenantId,
      kind: 'feed.post',
      dedupeKey: `test08.1-07:${randomUUID()}`,
      userIds: [created.userId],
      push: {
        title: 'tenant' as const,
        body: 'Novo post: identidade compartilhada',
        url: '/inicio',
        tag: 'feed-post',
        topic: 'feed-post',
        ttlSeconds: 86_400,
        urgency: 'normal' as const,
        renotify: false,
      },
      attempt: 0,
    });
    const demoEndpoint = `${FAKE}/sub/si-demo-${randomUUID()}`;
    const labEndpoint = `${FAKE}/sub/si-lab-${randomUUID()}`;
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${labId}::uuid, 'notifications', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(labId);

      expect(
        (await onHost('POST', HOSTS.demo, { endpoint: demoEndpoint, keys: deviceKeys() })).status,
      ).toBe(204);
      expect(
        (await onHost('POST', HOSTS.lab, { endpoint: labEndpoint, keys: deviceKeys() })).status,
      ).toBe(204);
      const both = [
        { tenant_id: ids.demo, endpoint: demoEndpoint },
        { tenant_id: labId, endpoint: labEndpoint },
      ].sort((a, b) => (a.tenant_id < b.tenant_id ? -1 : 1));
      expect(await rowsOfS()).toEqual(both);

      // A rede-lab push for S reaches the lab device only, never the demo one — and the reverse.
      await pushSendJob.handler(job(labId));
      expect(fakePushOutbox().map((send) => send.endpoint)).toEqual([labEndpoint]);
      resetFakePushOutbox();
      await pushSendJob.handler(job(ids.demo));
      expect(fakePushOutbox().map((send) => send.endpoint)).toEqual([demoEndpoint]);

      // Forgetting the demo device on the lab host (and the lab one on the demo host): 204, no
      // oracle, and both rows are still there.
      expect((await onHost('DELETE', HOSTS.lab, { endpoint: demoEndpoint })).status).toBe(204);
      expect((await onHost('DELETE', HOSTS.demo, { endpoint: labEndpoint })).status).toBe(204);
      expect(await rowsOfS()).toEqual(both);

      // Positive control: each device is forgotten on ITS OWN host, and only that row goes.
      expect((await onHost('DELETE', HOSTS.demo, { endpoint: demoEndpoint })).status).toBe(204);
      expect(await rowsOfS()).toEqual([{ tenant_id: labId, endpoint: labEndpoint }]);
      expect((await onHost('DELETE', HOSTS.lab, { endpoint: labEndpoint })).status).toBe(204);
      expect(await rowsOfS()).toEqual([]);
    } finally {
      await adminSql`delete from public.push_subscriptions where user_id = ${created.userId}::uuid`;
      if (labFlag) {
        await adminSql`
          update public.tenant_modules set enabled = ${labFlag.enabled}
           where tenant_id = ${labId}::uuid and module_key = 'notifications'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${labId}::uuid and module_key = 'notifications'`;
      }
      moduleFlags.invalidate(labId);
      await removeIdentitiesByPrefix(PREFIX);
    }
  });
});
