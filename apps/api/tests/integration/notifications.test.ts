import type { Bootstrap } from '@rede-social/contracts';
import type { NotificationPage } from '@rede-social/module-notifications/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  notificationJobsOf,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * `@rede-social/module-notifications` end to end against the live local stack and the real seed
 * (07-01) — the Phase 7 tracer, proved rather than asserted.
 *
 * `notifications tracer`: the demo admin's `POST /v1/feed/posts` commits, the bus hands
 * `post.published` to the notification sink, which enqueues ONE `notifications.fanout` job; the test
 * plays the worker (`runNotificationJobs`), the job asks the FEED's source (through the kernel seam)
 * for intents and delivers them through the `in_app` channel: `app.notifications_fanout` writes one
 * row per live member and `app.realtime_signal` publishes ONE ids-only signal on the tenant topic.
 * The member then reads the row through `GET /v1/notifications` and the count through the bootstrap.
 * That one path crosses two module packages that never import each other, the app registry, the bus,
 * pg-boss, both definers, the owner-only policies and the keyset read.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order). Both hooks sweep this
 * file's own posts by caption prefix and the demo tenant's notification rows, and mark any fan-out job
 * other files left waiting as completed, so the counts here are exact.
 */

const tokens = { demoAdmin: '', demoMember: '' };
const ids = { demo: '', demoMember: '' };

/** The prefix every post THIS FILE writes carries, so the sweep can be exact. */
const TEST_CAPTION_PREFIX = 'Notificacao de teste';

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': HOSTS.demo,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

async function list(token: string, query = ''): Promise<NotificationPage> {
  const res = await request(`/v1/notifications${query}`, token);
  expect(res.status, `GET /v1/notifications${query}`).toBe(200);
  return (await res.json()) as NotificationPage;
}

/** Waiting fan-out jobs other files enqueued would write rows here; they are closed, not run. */
async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'`;
}

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.notifications
     where tenant_id in (select id from public.tenants where slug = 'rede-demo')`;
  await adminSql`delete from public.feed_posts where caption like ${`${TEST_CAPTION_PREFIX}%`}`;
  await closeWaitingJobs();
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  const [tenant] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-demo'`;
  const [member] = await adminSql<{ id: string }[]>`
    select id from auth.users where email = 'member@rede-demo.local'`;
  ids.demo = tenant?.id ?? '';
  ids.demoMember = member?.id ?? '';
  await sweep();
});

afterAll(async () => {
  await sweep();
});

describe('notifications tracer', () => {
  it("an admin's post becomes one row, one count and one ids-only signal for a member", async () => {
    const [{ now: startedAt } = { now: new Date() }] = await adminSql<{ now: Date }[]>`
      select now() as now`;

    // 1. The demo admin publishes a text post; the sink enqueues ONE fan-out job; the worker runs it.
    const created = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} tracer` }),
    });
    expect(created.status).toBe(201);
    const post = (await created.json()) as { id: string };
    const waiting = (await notificationJobsOf(ids.demo)).filter((job) => job.state === 'created');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.data).toMatchObject({ event: 'post.published', tenantId: ids.demo });
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    // 2. The member's Novas hold exactly one `feed.post` row for that post.
    const unread = await list(tokens.demoMember, '?section=unread');
    const rows = unread.items.filter((row) => row.subject.id === post.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('feed.post');
    expect(rows[0]?.subject).toEqual({ type: 'post', id: post.id });
    expect(rows[0]?.actor?.removed).toBe(false);
    expect(rows[0]?.actor?.displayName).toBeTruthy();
    expect(rows[0]?.facts.excerpt).toBe(`${TEST_CAPTION_PREFIX} tracer`);
    expect(rows[0]?.readAt).toBeNull();
    expect(rows[0]?.seenAt).toBeNull();

    // 3. The member's bootstrap counts it.
    const bootstrap = await request('/v1/me/bootstrap', tokens.demoMember);
    expect(bootstrap.status).toBe(200);
    expect(((await bootstrap.json()) as Bootstrap).counters.unreadNotifications).toBe(1);

    // 4. The author is never notified (D-229).
    const adminList = await list(tokens.demoAdmin, '?section=unread');
    expect(adminList.items.filter((row) => row.subject.id === post.id)).toHaveLength(0);

    // 5. ONE committed signal on the tenant topic, ids only. The installed `realtime.send` adds the
    //    message's own id to a payload lacking one, so the keys are `id` and `kind`, and `id` is the
    //    realtime message row's own id (still no excerpt, name or title).
    const signals = await adminSql<{ id: string; payload: Record<string, unknown> }[]>`
      select id::text as id, payload
        from realtime.messages
       where topic = ${`tenant:${ids.demo}:all`}
         and event = 'notifications.changed'
         and inserted_at >= ${startedAt}`;
    expect(signals).toHaveLength(1);
    expect(Object.keys(signals[0]?.payload ?? {}).sort()).toEqual(['id', 'kind']);
    expect(signals[0]?.payload.kind).toBe('feed.post');
    expect(signals[0]?.payload.id).toBe(signals[0]?.id);
  });
});
