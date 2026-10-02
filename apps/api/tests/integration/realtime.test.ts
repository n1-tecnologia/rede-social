import {
  convTopic,
  inboxTopic,
  REALTIME_EVENTS,
  tenantTopic,
  userTopic,
} from '@rede-social/contracts/realtime';
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
 * `realtime chat (live)` (07-08): the chat triggers' ids-only signals, on a support thread that
 * `SECOND` (a demo member) opens through the real API in chat case 1. Her own conversation and user
 * topics receive `chat.message` / `chat.unread` when the support user replies; the support user's
 * `support-inbox` and `conv:` channels receive her messages; `MEMBER` (another member of the same
 * tenant) can join neither her `conv:` nor `support-inbox`; with `chat` disabled a fresh `conv:` join
 * is refused; and a staff message inserted inside a rolled-back transaction delivers nothing (A3).
 *
 * Order and cleanup: every client is disconnected in `afterEach`; posts carry a caption prefix and
 * are swept with the demo tenant's notification rows before and after the file; waiting fan-out jobs
 * other files left behind are closed, never run. `SECOND`'s support conversation is swept too (the
 * seeded thread belongs to `MEMBER` and is never touched here).
 */

const MEMBER = 'member@rede-demo.local';
const ADMIN = 'admin@rede-demo.local';
const SECOND = 'iris.munoz@rede-demo.local';
const LAB_MEMBER = 'member@rede-lab.local';
const SUPPORT = 'support@rede-demo.local';
const CAPTION = 'Realtime ao vivo de teste';

const ids = { demo: '', lab: '', member: '', second: '', labMember: '', support: '' };

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
  if (ids.second) {
    await adminSql`
      delete from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and created_by_user_id = ${ids.second}::uuid`;
  }
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
  ids.support = await idOf(SUPPORT);
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

/* ── 07-08: the chat signals, live ──────────────────────────────────────────────────────────── */

/** `SECOND`'s support conversation, created through the API by chat case 1. */
const chat = { conversationId: '' };

const chatRequest = (path: string, token: string, body: unknown) =>
  api.request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-tenant-host': HOSTS.demo,
    },
    body: JSON.stringify(body),
  });

describe('realtime chat (live)', () => {
  it('1. the member hears the reply on conv: and the dot on its own user topic, ids only', async () => {
    const memberToken = await signInAs(SECOND, SEED_PASSWORD);
    const first = await chatRequest('/v1/chat/support/messages', memberToken, {
      body: 'Oi, a equipe pode me ajudar?',
    });
    expect(first.status).toBe(201);
    chat.conversationId = ((await first.json()) as { conversationId: string }).conversationId;

    const { client } = await connectAs(SECOND);
    const conv = await joinTopic(client, convTopic(ids.demo, chat.conversationId));
    const own = await joinTopic(client, userTopic(ids.demo, ids.second));
    observed['chat 1 own conv'] = conv.status;
    expect(conv.status).toBe('SUBSCRIBED');
    expect(own.status).toBe('SUBSCRIBED');

    const supportToken = await signInAs(SUPPORT, SEED_PASSWORD);
    const reply = await chatRequest(
      `/v1/chat/conversations/${chat.conversationId}/messages`,
      supportToken,
      { body: 'Claro! Estamos aqui.' },
    );
    expect(reply.status).toBe(201);

    const message = await waitForBroadcast(conv, REALTIME_EVENTS.chatMessage, 10_000);
    expect(message, 'chat.message on conv:').not.toBeNull();
    expect(Object.keys(message?.payload ?? {}).sort()).toEqual(['conversationId', 'id', 'seq']);
    expect(message?.payload).toMatchObject({ conversationId: chat.conversationId, seq: 2 });
    const unread = await waitForBroadcast(own, REALTIME_EVENTS.chatUnread, 10_000);
    expect(unread, 'chat.unread on the member topic').not.toBeNull();
    expect(unread?.payload).toMatchObject({ conversationId: chat.conversationId, seq: 2 });
  });

  it("2. the support user hears the member's message on support-inbox and conv:", async () => {
    const { client } = await connectAs(SUPPORT);
    const inbox = await joinTopic(client, inboxTopic(ids.demo));
    const conv = await joinTopic(client, convTopic(ids.demo, chat.conversationId));
    observed['chat 2 staff inbox'] = inbox.status;
    observed['chat 2 staff conv'] = conv.status;
    expect(inbox.status).toBe('SUBSCRIBED');
    expect(conv.status).toBe('SUBSCRIBED');

    const memberToken = await signInAs(SECOND, SEED_PASSWORD);
    const sent = await chatRequest('/v1/chat/support/messages', memberToken, {
      body: 'Obrigada!',
    });
    expect(sent.status).toBe(201);

    for (const joined of [inbox, conv]) {
      const got = await waitForBroadcast(joined, REALTIME_EVENTS.chatMessage, 10_000);
      expect(got, `chat.message on ${joined.topic}`).not.toBeNull();
      expect(got?.payload).toMatchObject({ conversationId: chat.conversationId, seq: 3 });
    }
  });

  it("3. negatives: another demo member joins neither the first member's conv: nor support-inbox", async () => {
    const [foreignConv, inbox] = await Promise.all([
      (async () =>
        joinTopic((await connectAs(MEMBER)).client, convTopic(ids.demo, chat.conversationId)))(),
      (async () => joinTopic((await connectAs(MEMBER)).client, inboxTopic(ids.demo)))(),
    ]);
    observed['chat 3 other member conv'] = foreignConv.status;
    observed['chat 3 member inbox'] = inbox.status;
    expectNotSubscribed(foreignConv);
    expectNotSubscribed(inbox);

    // Positive control in the same test: the thread's own member joins it.
    const owner = await connectAs(SECOND);
    const own = await joinTopic(owner.client, convTopic(ids.demo, chat.conversationId));
    expect(own.status).toBe('SUBSCRIBED');

    const supportToken = await signInAs(SUPPORT, SEED_PASSWORD);
    expect(
      (
        await chatRequest(`/v1/chat/conversations/${chat.conversationId}/messages`, supportToken, {
          body: 'Mais alguma coisa?',
        })
      ).status,
    ).toBe(201);
    expect(await waitForBroadcast(own, REALTIME_EVENTS.chatMessage, 10_000)).not.toBeNull();
    await sleep(1_500);
    expect(foreignConv.received).toEqual([]);
    expect(inbox.received).toEqual([]);
  }, 60_000);

  it('4. module gate: with chat disabled, a fresh conv: join is refused while user: still joins', async () => {
    const { client } = await connectAs(SECOND);
    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${ids.demo}::uuid and module_key = 'chat'`;
      moduleFlags.invalidate(ids.demo);
      const conv = await joinTopic(client, convTopic(ids.demo, chat.conversationId));
      const own = await joinTopic(client, userTopic(ids.demo, ids.second));
      observed['chat 4 conv (disabled)'] = conv.status;
      expectNotSubscribed(conv);
      expect(own.status).toBe('SUBSCRIBED');
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${ids.demo}::uuid and module_key = 'chat'`;
      moduleFlags.invalidate(ids.demo);
    }
  });

  it('5. A3 for chat: a staff message inside a rolled-back transaction delivers nothing', async () => {
    const { client } = await connectAs(SECOND);
    const conv = await joinTopic(client, convTopic(ids.demo, chat.conversationId));
    expect(conv.status).toBe('SUBSCRIBED');

    const rollback = new Error('rollback on purpose');
    await expect(
      adminSql.begin(async (tx) => {
        await tx`
          insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
          values (${ids.demo}::uuid, ${chat.conversationId}::uuid, ${ids.support}::uuid, 'staff',
                  'nunca enviada')`;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await waitForBroadcast(conv, REALTIME_EVENTS.chatMessage, 2_000)).toBeNull();

    // Control: the same staff message, committed through the API, arrives, and took the NEXT seq
    // (the rolled-back insert left no gap).
    const supportToken = await signInAs(SUPPORT, SEED_PASSWORD);
    const reply = await chatRequest(
      `/v1/chat/conversations/${chat.conversationId}/messages`,
      supportToken,
      { body: 'Agora sim.' },
    );
    expect(reply.status).toBe(201);
    const got = await waitForBroadcast(conv, REALTIME_EVENTS.chatMessage, 10_000);
    expect(got?.payload).toMatchObject({ conversationId: chat.conversationId, seq: 5 });
  });
});

/* ── 08-10: the cross-tenant joins, every topic kind ─────────────────────────────────────────── */

const LAB_SUPPORT = 'support@rede-lab.local';
/** A rede-lab support thread written for this case only (removed in `finally`). */
const LAB_CONVERSATION = '0b100000-0000-4000-8000-0000000008a0';

describe('cross-tenant (live)', () => {
  it("cross-tenant: a rede-demo session is refused on every one of rede-lab's four topic kinds (all, user:, support-inbox, conv:), beside its own topic and the lab's own joins (08-10, RESEARCH Pattern 6)", async () => {
    // pgTAP 150 proves `app.realtime_topic_allowed` row by row and cases 2 / chat 3 above prove the
    // in-tenant negatives; this is the CROSS-tenant half of the go-live gate (ROADMAP SC 4, D-344),
    // one live join per topic kind of `REALTIME_TOPIC_PATTERN`, with the demo's own topic as the
    // positive control in the same test.
    //
    // rede-lab has `notifications` and `chat` OFF in the seed. Both are turned ON here, and the lab's
    // own member and support user are shown to JOIN their own topics, so every demo refusal below
    // comes from the TENANT check, never from a module being off. Restored in `finally`.
    const labSupportId = await idOf(LAB_SUPPORT);
    const flagsBefore = await adminSql<{ module_key: string; enabled: boolean }[]>`
      select module_key, enabled from public.tenant_modules
       where tenant_id = ${ids.lab}::uuid and module_key in ('notifications', 'chat')`;
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${ids.lab}::uuid, 'notifications', true), (${ids.lab}::uuid, 'chat', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(ids.lab);
      await adminSql`
        insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
        values (${LAB_CONVERSATION}::uuid, ${ids.lab}::uuid, 'support', ${ids.labMember}::uuid)`;
      await adminSql`
        insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
        values (${LAB_CONVERSATION}::uuid, ${ids.lab}::uuid, ${ids.labMember}::uuid, 'member')`;

      // The four lab topics, each kind once. `support-inbox` is attempted by demo STAFF (the only
      // role that joins its own tenant's inbox), the other three by a demo member.
      const crossings = [
        ['all', MEMBER, tenantTopic(ids.lab)],
        ['user', MEMBER, userTopic(ids.lab, ids.labMember)],
        ['support-inbox', SUPPORT, inboxTopic(ids.lab)],
        ['conv', MEMBER, convTopic(ids.lab, LAB_CONVERSATION)],
      ] as const;
      // The lab's OWN joins of the same four topics: the proof the topics are live for their owners.
      const owners = [
        ['all', LAB_MEMBER, tenantTopic(ids.lab)],
        ['user', LAB_MEMBER, userTopic(ids.lab, ids.labMember)],
        ['support-inbox', LAB_SUPPORT, inboxTopic(ids.lab)],
        ['conv', LAB_MEMBER, convTopic(ids.lab, LAB_CONVERSATION)],
      ] as const;

      // One socket per join, in parallel (case 2's reason: refusals sharing a socket queue up).
      const [refused, admitted, own] = await Promise.all([
        Promise.all(
          crossings.map(async ([, email, topic]) =>
            joinTopic((await connectAs(email)).client, topic),
          ),
        ),
        Promise.all(
          owners.map(async ([, email, topic]) => joinTopic((await connectAs(email)).client, topic)),
        ),
        (async () =>
          joinTopic((await connectAs(MEMBER)).client, userTopic(ids.demo, ids.member)))(),
      ]);

      // Positive control: the demo member's own topic joins in the same test.
      observed['cross-tenant own demo user'] = own.status;
      expect(own.status).toBe('SUBSCRIBED');
      for (const [index, [kind]] of owners.entries()) {
        const joined = admitted[index];
        observed[`cross-tenant lab ${kind} (owner)`] = joined?.status ?? 'missing';
        expect(joined?.status, `the lab's own ${kind} join`).toBe('SUBSCRIBED');
      }
      for (const [index, [kind]] of crossings.entries()) {
        const joined = refused[index];
        if (!joined) throw new Error(`no join for ${kind}`);
        observed[`cross-tenant demo -> lab ${kind}`] = joined.status;
        expectNotSubscribed(joined);
      }

      // A signal on every lab topic, then the demo member's own: the owners hear theirs, the own
      // topic hears its own, and the four refused channels hear nothing at all.
      await signal(ids.lab, 'all', REALTIME_EVENTS.notificationsChanged, { kind: 'probe' });
      await signal(ids.lab, `user:${ids.labMember}`, REALTIME_EVENTS.notificationsChanged, {
        kind: 'probe',
      });
      await signal(ids.lab, 'support-inbox', REALTIME_EVENTS.chatMessage, { kind: 'probe' });
      await signal(ids.lab, `conv:${LAB_CONVERSATION}`, REALTIME_EVENTS.chatMessage, {
        kind: 'probe',
      });
      await signal(ids.demo, `user:${ids.member}`, REALTIME_EVENTS.notificationsChanged, {
        kind: 'probe',
      });
      expect(
        await waitForBroadcast(own, REALTIME_EVENTS.notificationsChanged, 10_000),
      ).not.toBeNull();
      for (const [index, [kind]] of owners.entries()) {
        const joined = admitted[index];
        if (!joined) throw new Error(`no owner join for ${kind}`);
        const event =
          kind === 'all' || kind === 'user'
            ? REALTIME_EVENTS.notificationsChanged
            : REALTIME_EVENTS.chatMessage;
        expect(await waitForBroadcast(joined, event, 10_000), `the lab's ${kind}`).not.toBeNull();
      }
      await sleep(1_500);
      for (const [index, [kind]] of crossings.entries()) {
        expect(refused[index]?.received, `demo -> lab ${kind} received`).toEqual([]);
      }
      expect(labSupportId).not.toBe('');
    } finally {
      await adminSql`delete from public.chat_conversations where id = ${LAB_CONVERSATION}::uuid`;
      // The lab's rows go back EXACTLY as found (the seed keeps both modules off for rede-lab).
      for (const key of ['notifications', 'chat'] as const) {
        const found = flagsBefore.find((row) => row.module_key === key);
        if (found) {
          await adminSql`
            update public.tenant_modules set enabled = ${found.enabled}
             where tenant_id = ${ids.lab}::uuid and module_key = ${key}`;
        } else {
          await adminSql`
            delete from public.tenant_modules
             where tenant_id = ${ids.lab}::uuid and module_key = ${key}`;
        }
      }
      moduleFlags.invalidate(ids.lab);
    }
  }, 90_000);
});
