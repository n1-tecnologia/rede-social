import type { Bootstrap } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { encodeCursor } from '@rede-social/core/server/paging';
import {
  NOTIF_MAX_CURSOR_LENGTH,
  NOTIF_MAX_PAGE_SIZE,
  type NotificationPage,
  type NotificationRow,
} from '@rede-social/module-notifications/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  authAdmin,
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
const ids = { demo: '', demoMember: '', demoAdmin: '', demoSecond: '' };

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
  const [admin] = await adminSql<{ id: string }[]>`
    select id from auth.users where email = 'admin@rede-demo.local'`;
  ids.demo = tenant?.id ?? '';
  ids.demoMember = member?.id ?? '';
  ids.demoAdmin = admin?.id ?? '';
  // Another live member of the demo tenant: the owner of the row the member must not reach.
  const [second] = await adminSql<{ user_id: string }[]>`
    select m.user_id::text as user_id from public.memberships m
     where m.tenant_id = ${ids.demo}::uuid and m.role = 'member' and m.status = 'active'
       and m.deleted_at is null and m.user_id <> ${ids.demoMember}::uuid
     order by m.joined_at limit 1`;
  ids.demoSecond = second?.user_id ?? '';
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

/* ── 07-01 Task 3: the list, the marks and the fan-out battery ───────────────────────────────── */

/** Removes every notification row of the demo tenant (the member starts each case from zero). */
async function clearDemo(): Promise<void> {
  await adminSql`delete from public.notifications where tenant_id = ${ids.demo}::uuid`;
}

/**
 * A fixture row for `userId` in the demo tenant, written as the migration role. Returns its id.
 *
 * The instants are bound as TEXT and cast by Postgres: this raw postgres.js client serializes a
 * parameter it infers as `timestamptz` through a JS `Date`, which truncates to milliseconds (the
 * API's drizzle client installs pass-through serializers, so the service never loses the micros).
 */
async function insertRow(
  userId: string,
  opts: { createdAt?: string; readAt?: string | null; seenAt?: string | null; key?: string } = {},
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.notifications
      (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, payload, created_at, read_at, seen_at)
    values (${ids.demo}::uuid, ${userId}::uuid, 'feed.post',
            ${opts.key ?? `test07:${crypto.randomUUID()}`}, 'post', ${crypto.randomUUID()}::uuid,
            ${adminSql.json({ postId: crypto.randomUUID(), excerpt: 'x' })},
            coalesce(${opts.createdAt ?? null}::text::timestamptz, now()),
            ${opts.readAt ?? null}::text::timestamptz, ${opts.seenAt ?? null}::text::timestamptz)
    returning id::text as id`;
  return row?.id ?? '';
}

/** Every id of one section, walked with the returned cursors at `limit`. */
async function walk(section: 'unread' | 'read', limit = 1): Promise<NotificationRow[]> {
  const seen: NotificationRow[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const query: string = cursor
      ? `?section=${section}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?section=${section}&limit=${limit}`;
    const page = await list(tokens.demoMember, query);
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor, 'the walk terminated').toBeNull();
  return seen;
}

const post = (path: string, token: string) => request(path, token, { method: 'POST' });

async function counters(token: string): Promise<Bootstrap['counters']> {
  const res = await request('/v1/me/bootstrap', token);
  expect(res.status).toBe(200);
  return ((await res.json()) as Bootstrap).counters;
}

async function signalsSince(topic: string, since: Date): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from realtime.messages
     where topic = ${topic} and event = 'notifications.changed' and inserted_at >= ${since}`;
  return row?.n ?? 0;
}

async function dbNow(): Promise<Date> {
  const [row] = await adminSql<{ now: Date }[]>`select now() as now`;
  return row?.now ?? new Date();
}

/** Plays the worker for ONE synthetic `post.published` of the demo tenant (the handler, directly). */
async function fanOut(tenantId: string, postId: string, authorUserId: string): Promise<void> {
  const { notificationsFanoutJob } = await import('@rede-social/module-notifications/server');
  await notificationsFanoutJob.handler({
    event: 'post.published',
    tenantId,
    payload: {
      tenantId,
      postId,
      authorUserId,
      communityId: null,
      hasMedia: false,
      occurredAt: new Date().toISOString(),
    },
    sinkAt: new Date().toISOString(),
  });
}

describe('notifications list and marks', () => {
  it('NOTIF-01/02 ordering: a limit=1 walk of each section visits every row once, created_at desc, id desc', async () => {
    await clearDemo();
    // A deliberate created_at tie (broken by id) plus two distinct instants, in each section.
    const tie = '2026-09-01T10:00:00.000000Z';
    const unreadIds = [
      await insertRow(ids.demoMember, { createdAt: '2026-09-01T11:00:00.000000Z' }),
      await insertRow(ids.demoMember, { createdAt: tie }),
      await insertRow(ids.demoMember, { createdAt: tie }),
      await insertRow(ids.demoMember, { createdAt: '2026-09-01T09:00:00.000000Z' }),
    ];
    const readIds = [
      await insertRow(ids.demoMember, { createdAt: tie, readAt: tie, seenAt: tie }),
      await insertRow(ids.demoMember, { createdAt: tie, readAt: tie, seenAt: tie }),
      await insertRow(ids.demoMember, {
        createdAt: '2026-09-01T08:00:00.000000Z',
        readAt: tie,
        seenAt: tie,
      }),
    ];
    const tieOrder = (a: string, b: string) => (a < b ? 1 : -1);
    const expectedUnread = [
      unreadIds[0],
      ...[unreadIds[1], unreadIds[2]].sort((a, b) => tieOrder(a as string, b as string)),
      unreadIds[3],
    ];
    const expectedRead = [
      ...[readIds[0], readIds[1]].sort((a, b) => tieOrder(a as string, b as string)),
      readIds[2],
    ];
    expect((await walk('unread')).map((row) => row.id)).toEqual(expectedUnread);
    expect((await walk('read')).map((row) => row.id)).toEqual(expectedRead);
  });

  it('NOTIF-02 precision: two rows one microsecond apart are neither skipped nor repeated', async () => {
    await clearDemo();
    const later = await insertRow(ids.demoMember, { createdAt: '2026-09-02T10:00:00.000001Z' });
    const earlier = await insertRow(ids.demoMember, { createdAt: '2026-09-02T10:00:00.000000Z' });
    const walked = await walk('unread');
    expect(walked.map((row) => row.id)).toEqual([later, earlier]);
    expect(walked[0]?.createdAt).toBe('2026-09-02T10:00:00.000001Z');
  });

  it('NOTIF-02 boundary: limit clamps, a hostile or overlong cursor is page 1, an unknown section is 400', async () => {
    await clearDemo();
    for (let i = 0; i < 3; i++) await insertRow(ids.demoMember);
    expect((await list(tokens.demoMember, '?limit=0')).items).toHaveLength(1);
    const big = await list(tokens.demoMember, '?limit=100000');
    expect(big.items.length).toBeLessThanOrEqual(NOTIF_MAX_PAGE_SIZE);
    expect(big.items).toHaveLength(3);

    const first = await list(tokens.demoMember, '?limit=2');
    const hostile = encodeCursor({ n: 'not-an-instant', id: 'x' });
    const fromHostile = await list(
      tokens.demoMember,
      `?limit=2&cursor=${encodeURIComponent(hostile)}`,
    );
    expect(fromHostile.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id));
    const overlong = 'a'.repeat(NOTIF_MAX_CURSOR_LENGTH + 10);
    const fromOverlong = await list(tokens.demoMember, `?limit=2&cursor=${overlong}`);
    expect(fromOverlong.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id));

    for (const bad of ['READ', 'all']) {
      const res = await request(`/v1/notifications?section=${bad}`, tokens.demoMember);
      expect(res.status, `section=${bad}`).toBe(400);
    }
  });

  it('D-230: seen zeroes the bell while every row stays unread, and signals the member once', async () => {
    await clearDemo();
    for (let i = 0; i < 3; i++) await insertRow(ids.demoMember);
    expect((await counters(tokens.demoMember)).unreadNotifications).toBe(3);

    const since = await dbNow();
    const res = await post('/v1/notifications/seen', tokens.demoMember);
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await counters(tokens.demoMember)).unreadNotifications).toBe(0);

    const unread = await walk('unread', 10);
    expect(unread).toHaveLength(3);
    for (const row of unread) {
      expect(row.readAt).toBeNull();
      expect(row.seenAt).not.toBeNull();
    }
    expect(await signalsSince(`tenant:${ids.demo}:user:${ids.demoMember}`, since)).toBe(1);
  });

  it('NOTIF-02 empty: seen and read-all with nothing to change answer 204 and publish nothing', async () => {
    await clearDemo();
    const empty = await list(tokens.demoMember, '?section=unread');
    expect(empty).toEqual({ items: [], nextCursor: null });
    expect(await list(tokens.demoMember, '?section=read')).toEqual({ items: [], nextCursor: null });
    expect((await counters(tokens.demoMember)).unreadNotifications).toBe(0);

    const since = await dbNow();
    expect((await post('/v1/notifications/seen', tokens.demoMember)).status).toBe(204);
    expect((await post('/v1/notifications/read-all', tokens.demoMember)).status).toBe(204);
    expect(await signalsSince(`tenant:${ids.demo}:user:${ids.demoMember}`, since)).toBe(0);
  });

  it("D-230: read sets both stamps; a colleague's id and an unknown id are the bare 404", async () => {
    await clearDemo();
    const mine = await insertRow(ids.demoMember);
    const theirs = await insertRow(ids.demoSecond);

    expect((await post(`/v1/notifications/${mine}/read`, tokens.demoMember)).status).toBe(204);
    const [stamped] = await adminSql<{ read_at: Date | null; seen_at: Date | null }[]>`
      select read_at, seen_at from public.notifications where id = ${mine}::uuid`;
    expect(stamped?.read_at).not.toBeNull();
    expect(stamped?.seen_at).not.toBeNull();

    for (const id of [theirs, crypto.randomUUID()]) {
      const res = await post(`/v1/notifications/${id}/read`, tokens.demoMember);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; details?: unknown } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    }
    const [untouched] = await adminSql<{ read_at: Date | null }[]>`
      select read_at from public.notifications where id = ${theirs}::uuid`;
    expect(untouched?.read_at).toBeNull();
  });

  it('D-230: read-all moves every unread row to section=read', async () => {
    await clearDemo();
    const rows = [
      await insertRow(ids.demoMember),
      await insertRow(ids.demoMember),
      await insertRow(ids.demoMember),
    ];
    expect((await post('/v1/notifications/read-all', tokens.demoMember)).status).toBe(204);
    expect((await walk('unread', 10)).map((row) => row.id)).toEqual([]);
    expect((await walk('read', 10)).map((row) => row.id).sort()).toEqual([...rows].sort());
  });

  it('NOTIF-01 empty: a fan-out whose only member is the author inserts nothing and signals nothing', async () => {
    const slug = `rede-notif-solo-${Date.now()}`.slice(0, 40);
    const email = `solo-${Date.now()}@rede-notif.local`;
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Comunidade Solo', 'Regras de teste.', 1)
      returning id::text as id`;
    const tenantId = tenant?.id ?? '';
    const created = await authAdmin().createUser({
      email,
      password: 'Segredo123',
      email_confirm: true,
    });
    const userId = created.data.user?.id ?? '';
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantId}::uuid, 'notifications', true), (${tenantId}::uuid, 'feed', true)`;
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${tenantId}::uuid, ${userId}::uuid, 'member', 'active')`;
      const [soloPost] = await adminSql<{ id: string }[]>`
        insert into public.feed_posts (tenant_id, author_user_id, caption)
        values (${tenantId}::uuid, ${userId}::uuid, ${`${TEST_CAPTION_PREFIX} solo`})
        returning id::text as id`;
      const since = await dbNow();
      await fanOut(tenantId, soloPost?.id ?? '', userId);
      const [count] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.notifications where tenant_id = ${tenantId}::uuid`;
      expect(count?.n).toBe(0);
      expect(await signalsSince(`tenant:${tenantId}:all`, since)).toBe(0);
    } finally {
      await adminSql`delete from public.notifications where tenant_id = ${tenantId}::uuid`;
      await adminSql`delete from public.feed_posts where tenant_id = ${tenantId}::uuid`;
      await adminSql`
        delete from public.member_profiles
         where membership_id in (select id from public.memberships where tenant_id = ${tenantId}::uuid)`;
      await adminSql`delete from public.memberships where tenant_id = ${tenantId}::uuid`;
      await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
      if (userId) await authAdmin().deleteUser(userId);
    }
  });

  it('NOTIF-01 empty: a post soft-deleted before the job ran yields no row', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const created = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} apagado` }),
    });
    expect(created.status).toBe(201);
    const { id: postId } = (await created.json()) as { id: string };
    await adminSql`update public.feed_posts set deleted_at = now() where id = ${postId}::uuid`;
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications where subject_id = ${postId}::uuid`;
    expect(count?.n).toBe(0);
  });

  it('idempotency: the same fan-out job run twice keeps one row per member', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const created = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} duas vezes` }),
    });
    const { id: postId } = (await created.json()) as { id: string };
    const [job] = (await notificationJobsOf(ids.demo)).filter((row) => row.state === 'created');
    expect(job).toBeDefined();
    const { notificationsFanoutJob } = await import('@rede-social/module-notifications/server');
    const data = job?.data as Parameters<typeof notificationsFanoutJob.handler>[0];
    await notificationsFanoutJob.handler(data);
    const [once] = await adminSql<{ n: number; users: number }[]>`
      select count(*)::int as n, count(distinct user_id)::int as users
        from public.notifications where subject_id = ${postId}::uuid`;
    await notificationsFanoutJob.handler(data);
    const [twice] = await adminSql<{ n: number; users: number }[]>`
      select count(*)::int as n, count(distinct user_id)::int as users
        from public.notifications where subject_id = ${postId}::uuid`;
    expect(once?.n).toBeGreaterThan(0);
    expect(once?.n).toBe(once?.users);
    expect(twice).toEqual(once);
    await closeWaitingJobs();
  });

  it('D-229: neither the admin nor a support_tenant gets a feed.post row', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const email = `suporte-${Date.now()}@rede-demo.local`;
    const created = await authAdmin().createUser({
      email,
      password: 'Segredo123',
      email_confirm: true,
    });
    const supportId = created.data.user?.id ?? '';
    try {
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${ids.demo}::uuid, ${supportId}::uuid, 'support_tenant', 'active')`;
      const res = await request('/v1/feed/posts', tokens.demoAdmin, {
        method: 'POST',
        body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} equipe` }),
      });
      const { id: postId } = (await res.json()) as { id: string };
      expect(await runNotificationJobs(ids.demo)).toBe(1);
      const staff = await adminSql<{ user_id: string }[]>`
        select user_id::text as user_id from public.notifications
         where subject_id = ${postId}::uuid and user_id = any(${[ids.demoAdmin, supportId]}::uuid[])`;
      expect(staff).toEqual([]);
      const [member] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.notifications
         where subject_id = ${postId}::uuid and user_id = ${ids.demoMember}::uuid`;
      expect(member?.n, 'positive control: the member got it').toBe(1);
    } finally {
      await adminSql`delete from public.notifications where user_id = ${supportId}::uuid`;
      await adminSql`
        delete from public.member_profiles
         where membership_id in (select id from public.memberships where user_id = ${supportId}::uuid)`;
      await adminSql`delete from public.memberships where user_id = ${supportId}::uuid`;
      if (supportId) await authAdmin().deleteUser(supportId);
    }
  });

  it('D-226/D-227: a community post is feed.community_post; a video post is feed.reel and never feed.post', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const [community] = await adminSql<{ id: string; name: string }[]>`
      select id::text as id, name from public.communities
       where tenant_id = ${ids.demo}::uuid and status = 'active' and deleted_at is null
       order by created_at limit 1`;
    expect(community, 'the demo seed has an active community').toBeDefined();
    const res = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({
        caption: `${TEST_CAPTION_PREFIX} comunidade`,
        communityId: community?.id,
      }),
    });
    expect(res.status).toBe(201);
    const { id: communityPostId } = (await res.json()) as { id: string };
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const inCommunity = (await walk('unread', 10)).filter(
      (row) => row.subject.id === communityPostId,
    );
    expect(inCommunity.map((row) => row.kind)).toEqual(['feed.community_post']);
    expect(inCommunity[0]?.facts.communityName).toBe(community?.name);

    // A video post (written directly: the source reads `media_kind`, and a ready upload is the
    // media suites' concern), fanned out by the real job handler.
    const [video] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, media_kind)
      values (${ids.demo}::uuid, ${ids.demoAdmin}::uuid, ${`${TEST_CAPTION_PREFIX} video`}, 'video')
      returning id::text as id`;
    await fanOut(ids.demo, video?.id ?? '', ids.demoAdmin);
    const kinds = await adminSql<{ kind: string }[]>`
      select distinct kind from public.notifications where subject_id = ${video?.id ?? ''}::uuid`;
    expect(kinds.map((row) => row.kind)).toEqual(['feed.reel']);
  });

  it('module flag: with notifications off, a publish enqueues nothing and the list is 404 MODULE_DISABLED', async () => {
    await closeWaitingJobs();
    const before = (await notificationJobsOf(ids.demo)).length;
    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);
      const res = await request('/v1/feed/posts', tokens.demoAdmin, {
        method: 'POST',
        body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} desligado` }),
      });
      expect(res.status).toBe(201);
      expect((await notificationJobsOf(ids.demo)).length).toBe(before);

      const disabled = await request('/v1/notifications', tokens.demoMember);
      expect(disabled.status).toBe(404);
      expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe(
        'MODULE_DISABLED',
      );
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);
    }
  });
});

/* ── 07-04 Task 1: every other feed and stories kind, and the retractions ─────────────────────── */

describe('notifications tipos', () => {
  const kinds = { other: '', otherId: '' };
  const TIPOS_HIGHLIGHT = 'Notif destaque';
  const createdAssets: string[] = [];
  const createdStories: string[] = [];

  /** Every notification row of the demo tenant about `subjectId`, as the migration role sees it. */
  async function rowsAbout(subjectId: string) {
    return adminSql<
      {
        user_id: string;
        kind: string;
        object_id: string | null;
        actor_user_id: string | null;
        dedupe_key: string;
        payload: Record<string, unknown>;
      }[]
    >`
      select user_id::text as user_id, kind, object_id::text as object_id,
             actor_user_id::text as actor_user_id, dedupe_key, payload
        from public.notifications
       where tenant_id = ${ids.demo}::uuid and subject_id = ${subjectId}::uuid
       order by created_at, id`;
  }

  async function adminPost(label: string): Promise<string> {
    const res = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: `${TEST_CAPTION_PREFIX} ${label}` }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await runNotificationJobs(ids.demo);
    return id;
  }

  async function comment(
    token: string,
    postId: string,
    body: string,
    parentId?: string,
  ): Promise<string> {
    const res = await request(`/v1/feed/posts/${postId}/comments`, token, {
      method: 'POST',
      body: JSON.stringify(parentId ? { body, parentId } : { body }),
    });
    expect(res.status, `comment ${body}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  const likeComment = (token: string, commentId: string, method: 'POST' | 'DELETE' = 'POST') =>
    request(`/v1/feed/comments/${commentId}/like`, token, { method });

  /** A ready `purpose: 'story'` image of the demo admin, then `POST /v1/stories`. */
  async function adminStory(extra: Record<string, unknown> = {}): Promise<string> {
    const assetId = crypto.randomUUID();
    createdAssets.push(assetId);
    await adminSql`
      insert into public.media_assets
        (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths)
      values (${assetId}::uuid, ${ids.demo}::uuid, ${ids.demoAdmin}::uuid, 'image', 'story', 'ready',
              'supabase', 'image/webp', 1024, '{640,1080}'::int[])`;
    const res = await request('/v1/stories', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ mediaAssetId: assetId, mediaKind: 'image', caption: '', ...extra }),
    });
    expect(res.status, 'story published').toBe(201);
    const { id } = (await res.json()) as { id: string };
    createdStories.push(id);
    return id;
  }

  /** The demo tenant's LIVE `member`-role memberships (the broadcast audience, D-229). */
  async function liveMemberIds(): Promise<string[]> {
    const rows = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${ids.demo}::uuid and role = 'member' and status = 'active'
         and blocked_at is null and deleted_at is null`;
    return rows.map((row) => row.user_id);
  }

  beforeAll(async () => {
    const [other] = await adminSql<{ email: string; id: string }[]>`
      select u.email, u.id::text as id from public.users u
        join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${ids.demo}::uuid and m.role = 'member' and m.status = 'active'
         and m.deleted_at is null and u.email <> 'member@rede-demo.local'
       order by u.email limit 1`;
    if (!other) throw new Error('the seed must provide a second demo member');
    kinds.other = await signInAs(other.email, SEED_PASSWORD ?? '');
    kinds.otherId = other.id;
  });

  afterAll(async () => {
    if (createdStories.length > 0) {
      await adminSql`delete from public.stories where id = any(${createdStories}::uuid[])`;
    }
    await adminSql`
      delete from public.story_highlights
       where tenant_id = ${ids.demo}::uuid and title = ${TIPOS_HIGHLIGHT}`;
    if (createdAssets.length > 0) {
      await adminSql`delete from public.stories where media_asset_id = any(${createdAssets}::uuid[])`;
      await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
    }
  });

  it("D-226/D-235: a like on a member's comment is ONE in-app row for its author; unlike + re-like keeps one; a self-like none", async () => {
    await clearDemo();
    await closeWaitingJobs();
    const postId = await adminPost('curtida');
    const mine = await comment(tokens.demoMember, postId, 'Meu comentário');
    await runNotificationJobs(ids.demo);

    expect((await likeComment(kinds.other, mine)).status).toBe(200);
    await runNotificationJobs(ids.demo);
    const liked = (await rowsAbout(postId)).filter((row) => row.kind === 'feed.comment_liked');
    expect(liked).toHaveLength(1);
    expect(liked[0]).toMatchObject({
      user_id: ids.demoMember,
      object_id: mine,
      actor_user_id: kinds.otherId,
      dedupe_key: `feed.comment_liked:${mine}:${kinds.otherId}`,
    });
    expect(liked[0]?.payload).toEqual({ postId, commentId: mine, excerpt: 'Meu comentário' });

    // NOTIF-01 adjacency: an unlike then a re-like by the same actor collapses onto the same row.
    expect((await likeComment(kinds.other, mine, 'DELETE')).status).toBe(200);
    expect((await likeComment(kinds.other, mine)).status).toBe(200);
    await runNotificationJobs(ids.demo);
    expect(
      (await rowsAbout(postId)).filter((row) => row.kind === 'feed.comment_liked'),
    ).toHaveLength(1);

    // The member liking their OWN comment notifies nobody.
    expect((await likeComment(tokens.demoMember, mine)).status).toBe(200);
    await runNotificationJobs(ids.demo);
    const after = (await rowsAbout(postId)).filter((row) => row.kind === 'feed.comment_liked');
    expect(after).toHaveLength(1);
    expect(after.some((row) => row.actor_user_id === ids.demoMember)).toBe(false);
  });

  it("D-226/D-229: a reply is ONE row for the ROOT's author, staff included; a self-reply none", async () => {
    await clearDemo();
    await closeWaitingJobs();
    const postId = await adminPost('resposta');
    const mine = await comment(tokens.demoMember, postId, 'Pergunta do membro');
    const adminRoot = await comment(tokens.demoAdmin, postId, 'Comentário da equipe');
    await runNotificationJobs(ids.demo);
    // Root comments notify nobody (NOTIF-01 covers comments on the member's COMMENTS).
    expect((await rowsAbout(postId)).filter((row) => row.kind.startsWith('feed.comment'))).toEqual(
      [],
    );

    const reply = await comment(kinds.other, postId, 'Resposta ao membro', mine);
    const toAdmin = await comment(tokens.demoMember, postId, 'Resposta à equipe', adminRoot);
    await comment(tokens.demoMember, postId, 'Resposta a mim mesmo', mine);
    await runNotificationJobs(ids.demo);

    const replied = (await rowsAbout(postId)).filter((row) => row.kind === 'feed.comment_replied');
    expect(replied.map((row) => [row.user_id, row.object_id])).toEqual([
      [ids.demoMember, reply],
      [ids.demoAdmin, toAdmin],
    ]);
    expect(replied[0]?.payload).toEqual({
      postId,
      commentId: reply,
      rootCommentId: mine,
      excerpt: 'Resposta ao membro',
    });
  });

  it('D-226/D-229: a story is ONE stories.story row per live member, none for staff or the author, even when born in a highlight', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const members = await liveMemberIds();
    const plain = await adminStory();
    const inHighlight = await adminStory({
      newHighlight: { communityId: null, title: TIPOS_HIGHLIGHT },
    });
    await runNotificationJobs(ids.demo);

    for (const storyId of [plain, inHighlight]) {
      const rows = await rowsAbout(storyId);
      expect(rows.every((row) => row.kind === 'stories.story')).toBe(true);
      expect(rows.map((row) => row.user_id).sort()).toEqual([...members].sort());
      expect(rows.some((row) => row.user_id === ids.demoAdmin)).toBe(false);
      expect(rows[0]?.dedupe_key).toBe(`stories.story:${storyId}`);
      expect(rows[0]?.payload.storyId).toBe(storyId);
      expect(typeof rows[0]?.payload.expiresAt).toBe('string');
    }
  });

  it("D-226/D-229: a member's comment on the admin's story is ONE stories.story_commented row for the admin", async () => {
    await clearDemo();
    await closeWaitingJobs();
    const storyId = await adminStory();
    await runNotificationJobs(ids.demo);
    const res = await request(`/v1/stories/${storyId}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: 'Que lindo!' }),
    });
    expect(res.status).toBe(201);
    const { id: commentId } = (await res.json()) as { id: string };
    await runNotificationJobs(ids.demo);
    const rows = (await rowsAbout(storyId)).filter((row) => row.kind === 'stories.story_commented');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: ids.demoAdmin,
      object_id: commentId,
      actor_user_id: ids.demoMember,
    });
    expect(rows[0]?.payload).toMatchObject({ storyId, commentId, excerpt: 'Que lindo!' });
  });

  it('retraction (07 review B-WR-03): the FEED comment route cannot delete a story comment around its retraction', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const storyId = await adminStory();
    await runNotificationJobs(ids.demo);
    const res = await request(`/v1/stories/${storyId}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: 'Some pelo feed' }),
    });
    expect(res.status).toBe(201);
    const { id: commentId } = (await res.json()) as { id: string };
    await runNotificationJobs(ids.demo);
    const commented = () =>
      rowsAbout(storyId).then((rows) => rows.filter((r) => r.kind === 'stories.story_commented'));
    expect((await commented())[0]?.payload).toMatchObject({ excerpt: 'Some pelo feed' });

    // The feed route refuses a story comment (one bare 404), so it can never delete one without the
    // story retraction; the excerpt stays only while the comment itself does.
    const viaFeed = await request(`/v1/feed/comments/${commentId}`, tokens.demoMember, {
      method: 'DELETE',
    });
    expect(viaFeed.status).toBe(404);
    const [still] = await adminSql<{ deleted: boolean }[]>`
      select deleted_at is not null as deleted from public.feed_comments where id = ${commentId}::uuid`;
    expect(still?.deleted).toBe(false);

    // Positive control: the stories route deletes it and blanks the row.
    const removed = await request(
      `/v1/stories/${storyId}/comments/${commentId}`,
      tokens.demoMember,
      {
        method: 'DELETE',
      },
    );
    expect(removed.ok).toBe(true);
    await runNotificationJobs(ids.demo);
    const after = await commented();
    expect(after).toHaveLength(1);
    expect(after[0]?.payload).toEqual({ removed: true });
  });

  it('retraction: deleting the post marks its post, like and reply rows EXACTLY {removed: true}; the API answers removed with no facts', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const postId = await adminPost('apagado');
    const mine = await comment(tokens.demoMember, postId, 'Comentário que some');
    await likeComment(kinds.other, mine);
    await comment(kinds.other, postId, 'Resposta que some', mine);
    await runNotificationJobs(ids.demo);
    const before = await rowsAbout(postId);
    expect(new Set(before.map((row) => row.kind))).toEqual(
      new Set(['feed.post', 'feed.comment_liked', 'feed.comment_replied']),
    );

    const removed = await request(`/v1/feed/posts/${postId}`, tokens.demoAdmin, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    await runNotificationJobs(ids.demo);
    const after = await rowsAbout(postId);
    expect(after).toHaveLength(before.length);
    for (const row of after) expect(row.payload).toEqual({ removed: true });

    const page = await list(tokens.demoMember, '?section=unread&limit=50');
    const mineRows = page.items.filter((row) => row.subject.id === postId);
    expect(mineRows.length).toBeGreaterThan(0);
    for (const row of mineRows) {
      expect(row.removed).toBe(true);
      expect(row.facts).toEqual({});
      expect(row.preview).toBeNull();
    }
  });

  it('retraction (07 review A-WR-04): a delete while notifications is OFF still blanks the rows written while it was on', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const postId = await adminPost('apagado com o módulo desligado');
    await runNotificationJobs(ids.demo);
    const before = await rowsAbout(postId);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => row.payload.removed === undefined)).toBe(true);
    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);
      const removed = await request(`/v1/feed/posts/${postId}`, tokens.demoAdmin, {
        method: 'DELETE',
      });
      expect(removed.status).toBe(200);
      // The retraction is enqueued and run although the module is off.
      expect(await runNotificationJobs(ids.demo)).toBe(1);
      const after = await rowsAbout(postId);
      expect(after).toHaveLength(before.length);
      for (const row of after) expect(row.payload).toEqual({ removed: true });
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);
    }
  });

  it('retraction: deleting a comment marks only the rows whose OBJECT is that comment', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const postId = await adminPost('comentario apagado');
    const mine = await comment(tokens.demoMember, postId, 'Vai sumir');
    const kept = await comment(tokens.demoMember, postId, 'Vai ficar');
    await likeComment(kinds.other, mine);
    await likeComment(kinds.other, kept);
    await runNotificationJobs(ids.demo);

    const res = await request(`/v1/feed/comments/${mine}`, tokens.demoMember, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    await runNotificationJobs(ids.demo);
    const rows = await rowsAbout(postId);
    const gone = rows.find((row) => row.object_id === mine);
    const stays = rows.find((row) => row.object_id === kept);
    expect(gone?.payload).toEqual({ removed: true });
    expect(stays?.payload).toEqual({ postId, commentId: kept, excerpt: 'Vai ficar' });
    // The post's own broadcast rows (no object) are untouched.
    for (const row of rows.filter((r) => r.kind === 'feed.post')) {
      expect(row.payload.removed).toBeUndefined();
    }
  });

  it('retraction: deleting a story marks its broadcast and comment rows', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const storyId = await adminStory();
    await request(`/v1/stories/${storyId}/comments`, tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ body: 'Comentário no story' }),
    });
    await runNotificationJobs(ids.demo);
    const before = await rowsAbout(storyId);
    expect(new Set(before.map((row) => row.kind))).toEqual(
      new Set(['stories.story', 'stories.story_commented']),
    );

    const res = await request(`/v1/stories/${storyId}`, tokens.demoAdmin, { method: 'DELETE' });
    expect(res.status).toBe(204);
    await runNotificationJobs(ids.demo);
    const after = await rowsAbout(storyId);
    expect(after).toHaveLength(before.length);
    for (const row of after) expect(row.payload).toEqual({ removed: true });
  });
});

/* ── 07-05 Task 1: the event kinds (D-226), and the silent edit and cancel (D-201, D-214) ─────── */

describe('notifications eventos', () => {
  const EVENT_TITLE_PREFIX = 'Notif evento';

  /** Every notification row of the demo tenant about `eventId`, as the migration role sees it. */
  async function rowsAbout(eventId: string) {
    return adminSql<
      {
        user_id: string;
        kind: string;
        actor_user_id: string | null;
        dedupe_key: string;
        payload: Record<string, unknown>;
      }[]
    >`
      select user_id::text as user_id, kind, actor_user_id::text as actor_user_id, dedupe_key,
             payload
        from public.notifications
       where tenant_id = ${ids.demo}::uuid and subject_id = ${eventId}::uuid
       order by created_at, user_id`;
  }

  /** The demo tenant's LIVE `member`-role memberships (the broadcast audience, D-229). */
  async function liveMemberIds(): Promise<string[]> {
    const rows = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${ids.demo}::uuid and role = 'member' and status = 'active'
         and blocked_at is null and deleted_at is null`;
    return rows.map((row) => row.user_id).sort();
  }

  /** `YYYY-MM-DD` of the São Paulo calendar day `days` from now. */
  function tenantDate(days: number): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + days * 86_400_000));
  }

  function eventBody(suffix: string) {
    const date = tenantDate(4);
    return {
      title: `${EVENT_TITLE_PREFIX} ${suffix}`,
      description: '',
      format: 'online',
      meetingUrl: 'https://meet.example.test/notif',
      start: { date, time: '19:00' },
      end: { date, time: '21:00' },
    };
  }

  async function createEvent(suffix: string): Promise<{ id: string; startsAt: string }> {
    const res = await request('/v1/events', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify(eventBody(suffix)),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; startsAt: string };
  }

  const setStatus = (eventId: string, status: 'cancelled' | 'active') =>
    request(`/v1/events/${eventId}`, tokens.demoAdmin, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

  afterAll(async () => {
    await adminSql`delete from public.events where title like ${`${EVENT_TITLE_PREFIX}%`}`;
  });

  it('D-226/D-229: a new event is ONE events.event row per live member; none for the creator or staff', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const members = await liveMemberIds();
    const event = await createEvent('novo');
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const rows = await rowsAbout(event.id);
    expect(rows.every((row) => row.kind === 'events.event')).toBe(true);
    expect(rows.map((row) => row.user_id).sort()).toEqual(members);
    expect(rows.some((row) => row.user_id === ids.demoAdmin)).toBe(false);
    expect(rows[0]?.actor_user_id).toBe(ids.demoAdmin);
    expect(rows[0]?.dedupe_key).toBe(`events.event:${event.id}`);
    expect(rows[0]?.payload).toEqual({
      eventId: event.id,
      title: `${EVENT_TITLE_PREFIX} novo`,
      startsAt: event.startsAt,
      previewAssetId: null,
    });
  });

  it('D-201/D-214: an edit and a cancel add NO row and enqueue no fan-out', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const event = await createEvent('silencio');
    await runNotificationJobs(ids.demo);
    const before = await rowsAbout(event.id);

    const edited = await request(`/v1/events/${event.id}`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({ ...eventBody('silencio'), title: `${EVENT_TITLE_PREFIX} silencio 2` }),
    });
    expect(edited.status).toBe(200);
    // A moved start is an edit too: it re-arms reminders, and still notifies nobody.
    const moved = await request(`/v1/events/${event.id}`, tokens.demoAdmin, {
      method: 'PUT',
      body: JSON.stringify({
        ...eventBody('silencio'),
        title: `${EVENT_TITLE_PREFIX} silencio 2`,
        start: { date: tenantDate(4), time: '20:00' },
        end: { date: tenantDate(4), time: '22:00' },
      }),
    });
    expect(moved.status).toBe(200);
    expect((await setStatus(event.id, 'cancelled')).status).toBe(200);

    expect((await notificationJobsOf(ids.demo)).filter((job) => job.state === 'created')).toEqual(
      [],
    );
    expect(await runNotificationJobs(ids.demo)).toBe(0);
    expect(await rowsAbout(event.id)).toEqual(before);
  });

  it('D-226: two reactivations are two events.event_reactivated rows per member; a re-run of one job adds none', async () => {
    await clearDemo();
    await closeWaitingJobs();
    const members = await liveMemberIds();
    const event = await createEvent('reativado');
    await closeWaitingJobs();

    for (let round = 0; round < 2; round++) {
      expect((await setStatus(event.id, 'cancelled')).status).toBe(200);
      expect((await setStatus(event.id, 'active')).status).toBe(200);
      expect(await runNotificationJobs(ids.demo)).toBe(1);
    }
    const reactivated = (await rowsAbout(event.id)).filter(
      (row) => row.kind === 'events.event_reactivated',
    );
    expect(reactivated).toHaveLength(members.length * 2);
    for (const member of members) {
      expect(reactivated.filter((row) => row.user_id === member)).toHaveLength(2);
    }
    expect(reactivated.some((row) => row.user_id === ids.demoAdmin)).toBe(false);
    expect(new Set(reactivated.map((row) => row.dedupe_key)).size).toBe(2);

    // A retried job for the SAME reactivation reuses its sinkAt: nothing new.
    const { notificationsFanoutJob } = await import('@rede-social/module-notifications/server');
    const [job] = (await notificationJobsOf(ids.demo)).filter(
      (row) => row.data.event === 'event.reactivated',
    );
    expect(job).toBeDefined();
    await notificationsFanoutJob.handler(
      job?.data as Parameters<typeof notificationsFanoutJob.handler>[0],
    );
    expect(
      (await rowsAbout(event.id)).filter((row) => row.kind === 'events.event_reactivated'),
    ).toHaveLength(members.length * 2);
  });
});
