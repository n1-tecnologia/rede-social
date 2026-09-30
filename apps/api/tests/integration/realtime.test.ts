import { REALTIME_EVENTS, tenantTopic, userTopic } from '@rede-social/contracts/realtime';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  disconnectAll,
  expectNotSubscribed,
  joinTopic,
  signal,
  sleep,
  waitForBroadcast,
} from './realtime-helpers';
import { adminSql, api, HOSTS, runNotificationJobs, SEED_PASSWORD, signInAs } from './setup';

/**
 * ROADMAP Phase 7 SC 4, LIVE (07-03): a real `RealtimeClient` (realtime-js 2.116.0) against the local
 * stack's Realtime service, authorised by 07-01's definer policy (`app.realtime_topic_allowed`) with
 * each user's own GoTrue JWT. pgTAP 150 proves the policy row by row; this file proves the service
 * actually enforces it on a join, with a positive control beside every negative so a dead service can
 * never pass for a strict one.
 *
 *  1. Positive control: the demo member's own `user:` topic is SUBSCRIBED, and after the admin
 *     publishes and the worker fans out, its `all` channel receives `notifications.changed`, ids only.
 *  2. Negatives: another demo member's `user:` topic, a lab member's `user:` topic, `support-inbox`,
 *     `tenant:bad:all` and an upper-case-hex topic are never SUBSCRIBED and receive nothing, while
 *     the member's own topic receives its signal in the same test.
 *  3. Module gate: with `notifications` disabled, a fresh join of `all` is refused; `user:` still joins.
 *  4. Blocking: after `blocked_at` is set on the membership, a fresh join of its own topic is refused
 *     (T-07-15: an already-open socket keeps ids-only signals until its next token push; every API
 *     read is refused by `requireAuth`).
 *  5. RESEARCH A1: a `{ private: false }` join of the same topic receives nothing of a private signal.
 *  6. RESEARCH A3: a signal inside a rolled-back transaction is never delivered.
 *  7. Read-only browser: a subscribed client's `channel.send` reaches no other subscriber (no INSERT
 *     policy on `realtime.messages`, T-07-16).
 *
 * Order and cleanup: every client is disconnected in `afterEach`; posts carry a caption prefix and
 * are swept with the demo tenant's notification rows before and after the file; waiting fan-out jobs
 * other files left behind are closed, never run.
 */

const MEMBER = 'member@rede-demo.local';
const ADMIN = 'admin@rede-demo.local';
const SECOND = 'iris.munoz@rede-demo.local';
const LAB_MEMBER = 'member@rede-lab.local';
const CAPTION = 'Realtime ao vivo de teste';

const ids = { demo: '', lab: '', member: '', second: '', labMember: '' };

/** Observed join statuses, printed once for the plan's SUMMARY. */
const observed: Record<string, string> = {};

async function idOf(email: string): Promise<string> {
  const [row] = await adminSql<
    { id: string }[]
  >`select id::text as id from auth.users where email = ${email}`;
  if (!row) throw new Error(`seed user ${email} is missing (run pnpm db:seed)`);
  return row.id;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.notifications where tenant_id = ${ids.demo}::uuid`;
  await adminSql`delete from public.feed_posts where caption like ${`${CAPTION}%`}`;
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const tenants = await adminSql<{ slug: string; id: string }[]>`
    select slug, id::text as id from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  ids.member = await idOf(MEMBER);
  ids.second = await idOf(SECOND);
  ids.labMember = await idOf(LAB_MEMBER);
  await sweep();
});

afterEach(async () => {
  await disconnectAll();
});

afterAll(async () => {
  await sweep();
  // The observed statuses are the plan's evidence (07-03-SUMMARY), printed once.
  console.info('realtime.observed_join_statuses', observed);
});

describe('realtime authorisation (live)', () => {
  it('1. positive control: own user topic joins, and the fan-out reaches `all` with ids only', async () => {
    const { client } = await connectAs(MEMBER);
    const own = await joinTopic(client, userTopic(ids.demo, ids.member));
    const all = await joinTopic(client, tenantTopic(ids.demo));
    observed['1 own user'] = own.status;
    observed['1 all'] = all.status;
    expect(own.status).toBe('SUBSCRIBED');
    expect(all.status).toBe('SUBSCRIBED');

    const adminToken = await signInAs(ADMIN, SEED_PASSWORD);
    const created = await api.request('/v1/feed/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-tenant-host': HOSTS.demo,
      },
      body: JSON.stringify({ caption: `${CAPTION} positivo` }),
    });
    expect(created.status).toBe(201);
    expect(await runNotificationJobs(ids.demo)).toBe(1);

    const got = await waitForBroadcast(all, REALTIME_EVENTS.notificationsChanged, 10_000);
    expect(got, 'the fan-out signal on tenant:<t>:all').not.toBeNull();
    // Ids only: the installed `realtime.send` adds the message row's own `id`; nothing else rides.
    expect(Object.keys(got?.payload ?? {}).sort()).toEqual(['id', 'kind']);
    expect(got?.payload.kind).toBe('feed.post');
  });

  it('2. negatives: foreign user topics, support-inbox and malformed topics never join nor receive', async () => {
    const { client } = await connectAs(MEMBER);
    const own = await joinTopic(client, userTopic(ids.demo, ids.member));
    expect(own.status).toBe('SUBSCRIBED');

    // One socket per negative, joined in parallel: the local service answers a refused join about 5 s
    // later and handles one socket's joins in order, so refusals sharing a socket would queue behind
    // each other (and behind their own automatic re-joins) and delay the positive control's signal.
    const names = [
      'other demo member',
      'lab member',
      'support-inbox',
      'tenant:bad:all',
      'upper-case hex',
    ] as const;
    const topics = [
      userTopic(ids.demo, ids.second),
      userTopic(ids.lab, ids.labMember),
      `tenant:${ids.demo}:support-inbox`,
      'tenant:bad:all',
      `tenant:${ids.demo.toUpperCase()}:all`,
    ];
    const joins = await Promise.all(
      topics.map(async (topic) => joinTopic((await connectAs(MEMBER)).client, topic)),
    );
    const refused = Object.fromEntries(names.map((name, i) => [name, joins[i]]));
    for (const [name, joined] of Object.entries(refused)) {
      if (!joined) throw new Error(`no join for ${name}`);
      observed[`2 ${name}`] = joined.status;
      expectNotSubscribed(joined);
    }

    // Signals on every topic the definer can publish to, then the positive control last.
    await signal(ids.demo, `user:${ids.second}`, REALTIME_EVENTS.notificationsChanged, {
      kind: 'probe',
    });
    await signal(ids.lab, `user:${ids.labMember}`, REALTIME_EVENTS.notificationsChanged, {
      kind: 'probe',
    });
    await signal(ids.demo, 'support-inbox', REALTIME_EVENTS.chatMessage, { kind: 'probe' });
    await signal(ids.demo, `user:${ids.member}`, REALTIME_EVENTS.notificationsChanged, {
      kind: 'probe',
    });

    expect(
      await waitForBroadcast(own, REALTIME_EVENTS.notificationsChanged, 10_000),
    ).not.toBeNull();
    await sleep(1_500);
    for (const [name, joined] of Object.entries(refused)) {
      expect(joined?.received, `${name} received`).toEqual([]);
    }
  }, 60_000);

  it('3. module gate: with notifications disabled, `all` is refused while `user:` still joins', async () => {
    const { client } = await connectAs(MEMBER);
    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);

      const all = await joinTopic(client, tenantTopic(ids.demo));
      const own = await joinTopic(client, userTopic(ids.demo, ids.member));
      observed['3 all (disabled)'] = all.status;
      observed['3 own user (disabled)'] = own.status;
      expectNotSubscribed(all);
      expect(own.status).toBe('SUBSCRIBED');
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${ids.demo}::uuid and module_key = 'notifications'`;
      moduleFlags.invalidate(ids.demo);
    }
  });

  it('4. blocking: a blocked member cannot join even its own topic', async () => {
    const { client } = await connectAs(MEMBER);
    try {
      await adminSql`
        update public.memberships set blocked_at = now()
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
      const own = await joinTopic(client, userTopic(ids.demo, ids.member));
      observed['4 own user (blocked)'] = own.status;
      expectNotSubscribed(own);
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.member}::uuid`;
    }

    // Control: unblocked again, a fresh client joins.
    const again = await connectAs(MEMBER);
    expect((await joinTopic(again.client, userTopic(ids.demo, ids.member))).status).toBe(
      'SUBSCRIBED',
    );
  });

  it('5. A1: a non-private join of the same topic receives nothing of a private signal', async () => {
    const { client } = await connectAs(MEMBER);
    const privateJoin = await joinTopic(client, userTopic(ids.demo, ids.member));
    const other = await connectAs(MEMBER);
    const publicJoin = await joinTopic(other.client, userTopic(ids.demo, ids.member), {
      private: false,
    });
    observed['5 private'] = privateJoin.status;
    observed['5 public'] = publicJoin.status;
    expect(privateJoin.status).toBe('SUBSCRIBED');

    await signal(ids.demo, `user:${ids.member}`, REALTIME_EVENTS.notificationsChanged, {
      kind: 'probe',
    });
    expect(
      await waitForBroadcast(privateJoin, REALTIME_EVENTS.notificationsChanged, 10_000),
    ).not.toBeNull();
    await sleep(1_500);
    expect(publicJoin.received).toEqual([]);
  });

  it('6. A3: a signal inside a rolled-back transaction is never delivered', async () => {
    const { client } = await connectAs(MEMBER);
    const all = await joinTopic(client, tenantTopic(ids.demo));
    expect(all.status).toBe('SUBSCRIBED');

    const rollback = new Error('rollback on purpose');
    await expect(
      adminSql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ tenant_id: ids.demo })}, true)`;
        await tx`select app.realtime_signal('all', 'notifications.changed', '{"kind":"probe"}'::jsonb)`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(await waitForBroadcast(all, REALTIME_EVENTS.notificationsChanged, 2_000)).toBeNull();

    // Control: the same signal, committed, arrives.
    await signal(ids.demo, 'all', REALTIME_EVENTS.notificationsChanged, { kind: 'probe' });
    expect(
      await waitForBroadcast(all, REALTIME_EVENTS.notificationsChanged, 10_000),
    ).not.toBeNull();
  });

  it('7. read-only: a browser `channel.send` reaches no other subscriber', async () => {
    const sender = await connectAs(MEMBER);
    const listener = await connectAs(SECOND);
    const from = await joinTopic(sender.client, tenantTopic(ids.demo));
    const to = await joinTopic(listener.client, tenantTopic(ids.demo));
    expect(from.status).toBe('SUBSCRIBED');
    expect(to.status).toBe('SUBSCRIBED');

    const sent = await from.channel.send({
      type: 'broadcast',
      event: REALTIME_EVENTS.notificationsChanged,
      payload: { kind: 'forged' },
    });
    observed['7 channel.send answer'] = String(sent);
    expect(await waitForBroadcast(to, REALTIME_EVENTS.notificationsChanged, 2_000)).toBeNull();

    // Control: a definer signal on the same topic does reach the listener.
    await signal(ids.demo, 'all', REALTIME_EVENTS.notificationsChanged, { kind: 'probe' });
    const got = await waitForBroadcast(to, REALTIME_EVENTS.notificationsChanged, 10_000);
    expect(got?.payload.kind).toBe('probe');
  });
});
