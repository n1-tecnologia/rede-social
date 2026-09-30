import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import {
  type Bootstrap,
  type Counters,
  type ModuleKey,
  TENANT_ROLES,
  TOGGLEABLE_MODULES,
} from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  ConversationDetail,
  InboxPage,
  InboxRow,
  MessagePage,
  SendResult,
  SupportThread,
} from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor } from '../../src/modules/registry';
import {
  adminSql,
  api,
  authAdmin,
  HOSTS,
  pushSendJobsOf,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * `@rede-social/module-chat` end to end against the live local stack and the real seed (07-08).
 *
 * `chat tracer` (CHAT-02 into CHAT-04): the demo member writes to the team, the support user reads the
 * SAME message on the staff read of that conversation and replies, and the member's catch-up after
 * seq 1 returns exactly the reply, attributed by the agent's first name alone (D-222). Every insert
 * went through the seq trigger (seq 1, then 2) and the signal trigger, which committed one ids-only
 * `chat.message` row on the conversation topic and one on the support inbox per message.
 *
 * FIXTURES. The seed writes ONE support thread for `member@rede-demo.local` (`SEED_SUPPORT_*` in
 * `scripts/seed.ts`, mirrored below because the seed is a top-level-await script that cannot be
 * imported). The tracer needs that member WITHOUT a conversation (lazy creation, D-220), so it deletes
 * the thread first, and `sweep()` restores the seeded thread exactly (same ids, same bodies, seqs 1..3
 * assigned again by the trigger) before and after this file, so the realtime, isolation and e2e suites
 * always find it. Every other chat row of the two seed tenants is this file's own and is swept.
 *
 * `chat sequência` (CHAT-04, Pitfall 10): 20 concurrent first messages make ONE conversation with
 * seqs 1..20, 20 concurrent staff replies continue it without a gap, and the `afterSeq`/`beforeSeq`
 * reads answer exactly the missed range.
 *
 * `chat suporte` (CHAT-02, CHAT-03, CHAT-05, D-220..D-228): lazy creation, the body rules, staff
 * never owning a thread, first-name-only attribution, the inbox order/adjacency/empty cases, the
 * shared staff read, the member's dot, the blocked and departed refusals, the push-only source, the
 * module toggle and the TypeScript-versus-SQL staff role drift check.
 *
 * Throwaway members (`throwawayMember`) are created per case and removed in `afterAll`.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

/** Mirrors `scripts/seed.ts` (SEED_SUPPORT_CONVERSATION_ID / _MESSAGES / _MESSAGE_IDS). */
const SEED_THREAD = {
  id: '1d000000-0000-4000-8000-000000000001',
  messages: [
    ['1d000000-0000-4000-8000-000000000011', 'member', 'Oi, preciso de ajuda com meu cadastro.'],
    ['1d000000-0000-4000-8000-000000000012', 'staff', 'Oi! Como posso ajudar?'],
    ['1d000000-0000-4000-8000-000000000013', 'member', 'Quero trocar meu e-mail.'],
  ] as const,
};

const tokens = { demoMember: '', demoSupport: '', demoAdmin: '' };
const ids = { demo: '', lab: '', demoMember: '', demoSupport: '', demoAdmin: '' };

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

const post = (path: string, token: string, body: unknown) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) });

async function userId(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = ${email}`;
  return row?.id ?? '';
}

async function dbNow(): Promise<string> {
  const [row] = await adminSql<{ now: string }[]>`select now()::text as now`;
  return row?.now ?? '';
}

/** Every signal committed on `topic` since `since`, oldest first. */
async function signalsOn(topic: string, since: string) {
  return adminSql<{ id: string; event: string; payload: Record<string, unknown> }[]>`
    select id::text as id, event, payload
      from realtime.messages
     where topic = ${topic}
       and inserted_at >= ${since}::timestamptz
     order by inserted_at, id`;
}

/** Re-creates the seeded demo thread exactly; the triggers assign seqs 1..3 again. */
async function restoreSeedThread(): Promise<void> {
  await adminSql`delete from public.chat_conversations where id = ${SEED_THREAD.id}::uuid`;
  await adminSql`
    delete from public.chat_conversations
     where tenant_id = ${ids.demo}::uuid and kind = 'support'
       and created_by_user_id = ${ids.demoMember}::uuid`;
  await adminSql`
    insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
    values (${SEED_THREAD.id}::uuid, ${ids.demo}::uuid, 'support', ${ids.demoMember}::uuid)`;
  await adminSql`
    insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
    values (${SEED_THREAD.id}::uuid, ${ids.demo}::uuid, ${ids.demoMember}::uuid, 'member')`;
  for (const [id, side, body] of SEED_THREAD.messages) {
    const author = side === 'staff' ? ids.demoSupport : ids.demoMember;
    await adminSql`
      insert into public.chat_messages (id, tenant_id, conversation_id, author_user_id, author_side, body)
      values (${id}::uuid, ${ids.demo}::uuid, ${SEED_THREAD.id}::uuid, ${author}::uuid, ${side}, ${body})`;
  }
}

/** Throwaway demo users this file created (swept with their rows in `afterAll`). */
const throwaways: string[] = [];
const THROWAWAY_PASSWORD = 'Segredo123';

/**
 * A fresh live `member` (or staff) of the demo tenant with no conversation, signed in. Its profile is
 * created by the membership trigger with `display_name := users.name`.
 */
async function throwawayMember(
  label: string,
  role: 'member' | 'support_tenant' = 'member',
): Promise<{ id: string; token: string }> {
  const email = `chat-${label}-${Date.now()}@rede-demo.local`;
  const created = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: `Pessoa ${label}` },
  });
  const id = created.data.user?.id ?? '';
  if (!id) throw new Error(`could not create ${email}: ${created.error?.message}`);
  throwaways.push(id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${ids.demo}::uuid, ${id}::uuid, ${role}, 'active')`;
  return { id, token: await signInAs(email, THROWAWAY_PASSWORD) };
}

async function removeThrowaways(): Promise<void> {
  for (const id of throwaways.splice(0)) {
    await adminSql`delete from public.chat_messages where author_user_id = ${id}::uuid`;
    await adminSql`delete from public.chat_conversations where created_by_user_id = ${id}::uuid`;
    await adminSql`
      delete from public.member_profiles
       where membership_id in (select id from public.memberships where user_id = ${id}::uuid)`;
    await adminSql`delete from public.memberships where user_id = ${id}::uuid`;
    await authAdmin().deleteUser(id);
  }
}

/** Every chat row of both seed tenants goes, then the seeded thread comes back. */
async function sweep(): Promise<void> {
  await adminSql`
    delete from public.chat_conversations where tenant_id in (${ids.demo}::uuid, ${ids.lab}::uuid)`;
  await restoreSeedThread();
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  const tenants = await adminSql<{ slug: string; id: string }[]>`
    select slug, id::text as id from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  ids.demoMember = await userId('member@rede-demo.local');
  ids.demoSupport = await userId('support@rede-demo.local');
  ids.demoAdmin = await userId('admin@rede-demo.local');
  await sweep();
});

afterAll(async () => {
  await sweep();
  await removeThrowaways();
});

describe('chat tracer', () => {
  it('a member writes, the team reads and replies, and the member catches up after seq 1', async () => {
    // D-220: the member starts WITHOUT a conversation.
    await adminSql`delete from public.chat_conversations where id = ${SEED_THREAD.id}::uuid`;
    const before = await request('/v1/chat/support', tokens.demoMember);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ conversation: null, messages: [], hasOlder: false });

    // 1. The member writes to the team (201). The first message creates the conversation.
    const since = await dbNow();
    const sent = await post('/v1/chat/support/messages', tokens.demoMember, {
      body: 'Oi, preciso de ajuda',
    });
    expect(sent.status).toBe(201);
    const first = (await sent.json()) as SendResult;
    const conversationId = first.conversationId;
    expect(first.message).toMatchObject({
      seq: 1,
      side: 'member',
      body: 'Oi, preciso de ajuda',
      author: null,
      authorIsViewer: true,
    });

    // 2. The SAME message is on the support user's staff read of that conversation.
    const staffRead = await request(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
    );
    expect(staffRead.status).toBe(200);
    const staffPage = (await staffRead.json()) as MessagePage;
    expect(staffPage.items).toHaveLength(1);
    expect(staffPage.items[0]).toMatchObject({
      id: first.message.id,
      seq: 1,
      side: 'member',
      body: 'Oi, preciso de ajuda',
      authorIsViewer: false,
    });

    // 3. The staff reply gets seq 2.
    const replied = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
      { body: 'Oi! Aqui é a equipe.' },
    );
    expect(replied.status).toBe(201);
    const reply = (await replied.json()) as SendResult;
    expect(reply.message).toMatchObject({ seq: 2, side: 'staff', authorIsViewer: true });

    // 4. The member's catch-up after seq 1 is exactly the reply, with the agent's first name and
    //    NOTHING else about the agent (D-222).
    const caught = await request(
      `/v1/chat/conversations/${conversationId}/messages?afterSeq=1`,
      tokens.demoMember,
    );
    expect(caught.status).toBe(200);
    const raw = await caught.text();
    const page = JSON.parse(raw) as MessagePage;
    expect(page.items).toEqual([
      {
        id: reply.message.id,
        seq: 2,
        side: 'staff',
        body: 'Oi! Aqui é a equipe.',
        createdAt: reply.message.createdAt,
        author: { firstName: 'Carla' },
        authorIsViewer: false,
      },
    ]);
    expect(page.hasMore).toBe(false);
    expect(Object.keys(page.items[0]?.author ?? {})).toEqual(['firstName']);
    expect(raw).not.toContain('Rocha');
    expect(raw).not.toContain(ids.demoSupport);
    expect(raw).not.toContain('support@');

    // 5. Each insert committed ONE `chat.message` on the conversation topic and ONE on the support
    //    inbox, ids only. The installed `realtime.send` adds its own message-row `id` to a payload
    //    lacking one (the 07-01 finding), so the keys are `conversationId`, `id`, `seq`.
    for (const topic of [
      `tenant:${ids.demo}:conv:${conversationId}`,
      `tenant:${ids.demo}:support-inbox`,
    ]) {
      const signals = await signalsOn(topic, since);
      expect(
        signals.map((s) => [s.event, s.payload.seq]),
        topic,
      ).toEqual([
        ['chat.message', 1],
        ['chat.message', 2],
      ]);
      for (const signal of signals) {
        expect(Object.keys(signal.payload).sort()).toEqual(['conversationId', 'id', 'seq']);
        expect(signal.payload.conversationId).toBe(conversationId);
        expect(signal.payload.id).toBe(signal.id);
      }
    }
    // The staff reply also rang the member's own topic (the dot, D-237); the member's send did not.
    const unread = await signalsOn(`tenant:${ids.demo}:user:${ids.demoMember}`, since);
    expect(unread.map((s) => [s.event, s.payload.seq])).toEqual([['chat.unread', 2]]);

    // The member's seeded thread comes back for every later case (and file).
    await restoreSeedThread();
  });
});

/* ── 07-08 Task 2: gapless order under concurrency and the seq catch-up ──────────────────────── */

/** The conversation's seqs, straight from the table, ascending. */
async function seqsOf(conversationId: string): Promise<number[]> {
  const rows = await adminSql<{ seq: number }[]>`
    select seq::int as seq from public.chat_messages
     where conversation_id = ${conversationId}::uuid order by seq`;
  return rows.map((row) => row.seq);
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('chat sequência', () => {
  it('CHAT-04 concurrency: 20 simultaneous first messages make ONE conversation with seqs 1..20', async () => {
    const member = await throwawayMember('concorrente');
    const results = await Promise.all(
      range(1, 20).map((n) =>
        post('/v1/chat/support/messages', member.token, { body: `Mensagem ${n}` }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(20).fill(201));
    const bodies = (await Promise.all(results.map((res) => res.json()))) as SendResult[];

    // D-220 under a race: exactly one conversation, the one every answer names.
    const conversations = await adminSql<{ id: string; last_seq: number }[]>`
      select id::text as id, last_seq::int as last_seq from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support'
         and created_by_user_id = ${member.id}::uuid`;
    expect(conversations).toHaveLength(1);
    const conversationId = conversations[0]?.id ?? '';
    expect(new Set(bodies.map((body) => body.conversationId))).toEqual(new Set([conversationId]));

    // Contiguous and unique: the answers carry 1..20 once each, the table holds exactly 1..20.
    expect(bodies.map((body) => body.message.seq).sort((a, b) => a - b)).toEqual(range(1, 20));
    expect(await seqsOf(conversationId)).toEqual(range(1, 20));
    expect(conversations[0]?.last_seq).toBe(20);
    const [participants] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_participants
       where conversation_id = ${conversationId}::uuid`;
    expect(participants?.n).toBe(1);

    // 20 simultaneous STAFF replies to the same thread continue it with 21..40, no gap.
    const replies = await Promise.all(
      range(1, 20).map((n) =>
        post(`/v1/chat/conversations/${conversationId}/messages`, tokens.demoSupport, {
          body: `Resposta ${n}`,
        }),
      ),
    );
    expect(replies.map((res) => res.status)).toEqual(Array(20).fill(201));
    expect(await seqsOf(conversationId)).toEqual(range(1, 40));
    const [after] = await adminSql<
      { last_seq: number; last_staff_seq: number; staff_last_read_seq: number; side: string }[]
    >`
      select last_seq::int as last_seq, last_staff_seq::int as last_staff_seq,
             staff_last_read_seq::int as staff_last_read_seq, last_message_side as side
        from public.chat_conversations where id = ${conversationId}::uuid`;
    expect(after).toEqual({
      last_seq: 40,
      last_staff_seq: 40,
      staff_last_read_seq: 40,
      side: 'staff',
    });
  }, 60_000);

  it('D-240 catch-up: after missing 4..9, a client holding lastSeq 3 gets exactly 4..9', async () => {
    const member = await throwawayMember('catchup');
    let conversationId = '';
    for (const n of range(1, 9)) {
      const res = await post('/v1/chat/support/messages', member.token, { body: `Linha ${n}` });
      expect(res.status).toBe(201);
      conversationId = ((await res.json()) as SendResult).conversationId;
    }

    const after = await request(
      `/v1/chat/conversations/${conversationId}/messages?afterSeq=3`,
      member.token,
    );
    expect(after.status).toBe(200);
    const catchUp = (await after.json()) as MessagePage;
    expect(catchUp.items.map((item) => item.seq)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(catchUp.items.map((item) => item.body)).toEqual(range(4, 9).map((n) => `Linha ${n}`));
    expect(catchUp.hasMore).toBe(false);

    // The history page before seq 4, two at a time, answered ascending, with older ones left.
    const before = await request(
      `/v1/chat/conversations/${conversationId}/messages?beforeSeq=4&limit=2`,
      member.token,
    );
    expect(before.status).toBe(200);
    const history = (await before.json()) as MessagePage;
    expect(history.items.map((item) => item.seq)).toEqual([2, 3]);
    expect(history.hasMore).toBe(true);

    // A page of `limit` in the catch-up direction says there is more, exactly when there is.
    const paged = (await (
      await request(
        `/v1/chat/conversations/${conversationId}/messages?afterSeq=3&limit=3`,
        member.token,
      )
    ).json()) as MessagePage;
    expect(paged.items.map((item) => item.seq)).toEqual([4, 5, 6]);
    expect(paged.hasMore).toBe(true);

    // Nothing after the last seq is an empty, final page (the client's steady state).
    const idle = (await (
      await request(`/v1/chat/conversations/${conversationId}/messages?afterSeq=9`, member.token)
    ).json()) as MessagePage;
    expect(idle).toEqual({ conversationId, items: [], hasMore: false });

    // Both cursors at once is a 400, never a guess.
    expect(
      (
        await request(
          `/v1/chat/conversations/${conversationId}/messages?afterSeq=1&beforeSeq=5`,
          member.token,
        )
      ).status,
    ).toBe(400);
  });
});

/* ── 07-08 Task 3: the staff side, the badges and the push-only source ────────────────────────── */

/** Every key anywhere under a JSON value (D-222: nothing about an agent beyond the first name). */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysDeep(inner, into);
    }
  }
  return into;
}

const get = async <T>(path: string, token: string): Promise<T> => {
  const res = await request(path, token);
  expect(res.status, `GET ${path}`).toBe(200);
  return (await res.json()) as T;
};

async function bootstrapOf(token: string): Promise<Bootstrap> {
  return get<Bootstrap>('/v1/me/bootstrap', token);
}

/** Every inbox row id, walked with the returned cursors at `limit`. */
async function walkInbox(token: string, limit: number): Promise<InboxRow[]> {
  const seen: InboxRow[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard++) {
    const query: string = cursor
      ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`;
    const page = await get<InboxPage>(`/v1/chat/inbox${query}`, token);
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

/** A member of the demo tenant with a support thread whose latest message is theirs. */
async function memberWithThread(label: string): Promise<{
  id: string;
  token: string;
  conversationId: string;
}> {
  const member = await throwawayMember(label);
  const res = await post('/v1/chat/support/messages', member.token, { body: `Oi, sou ${label}.` });
  expect(res.status).toBe(201);
  return { ...member, conversationId: ((await res.json()) as SendResult).conversationId };
}

async function conversationCount(userIdValue: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.chat_conversations
     where tenant_id = ${ids.demo}::uuid and created_by_user_id = ${userIdValue}::uuid`;
  return row?.n ?? 0;
}

/** Fan-out jobs other cases (or files) left waiting would run here; they are closed, not run. */
async function closeWaitingFanouts(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'`;
}

const FAKE_PUSH = 'https://push.fake.test';

function deviceKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

describe('chat suporte', () => {
  it('D-220: GET /support before any send answers null and writes nothing', async () => {
    const member = await throwawayMember('lazy');
    expect(await get(`/v1/chat/support`, member.token)).toEqual({
      conversation: null,
      messages: [],
      hasOlder: false,
    });
    expect(await conversationCount(member.id)).toBe(0);
  });

  it('CHAT-02 empty and encoding: body_required, body_too_long, 2,000 emoji, inner newlines kept', async () => {
    const member = await throwawayMember('corpo');
    for (const body of ['   ', '\n\n\n', ' \t\r\n ']) {
      const res = await post('/v1/chat/support/messages', member.token, { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      const envelope = (await res.json()) as { error: { code: string; details?: unknown } };
      expect(envelope.error.code).toBe('VALIDATION_FAILED');
      expect(envelope.error.details).toEqual({ chat: 'body_required' });
    }
    // Nothing was created by a refused first message (D-220 + CHAT-02 empty).
    expect(await conversationCount(member.id)).toBe(0);

    const tooLong = await post('/v1/chat/support/messages', member.token, {
      body: '😀'.repeat(2001),
    });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: { details: unknown } }).error.details).toEqual({
      chat: 'body_too_long',
    });
    expect(await conversationCount(member.id)).toBe(0);

    const emoji = '😀'.repeat(2000);
    const accepted = await post('/v1/chat/support/messages', member.token, { body: emoji });
    expect(accepted.status).toBe(201);
    expect(((await accepted.json()) as SendResult).message.body).toBe(emoji);

    const lines = 'Linha 1\n\nLinha 2\n  recuo <b>não é HTML</b>';
    const sent = await post('/v1/chat/support/messages', member.token, { body: `  ${lines}\n\n` });
    expect(sent.status).toBe(201);
    const stored = (await sent.json()) as SendResult;
    expect(stored.message.body).toBe(lines);
    const [row] = await adminSql<{ body: string }[]>`
      select body from public.chat_messages where id = ${stored.message.id}::uuid`;
    expect(row?.body).toBe(lines);
  });

  it('D-223: staff never own a thread: the member routes are 403 for the admin and the support user', async () => {
    for (const token of [tokens.demoAdmin, tokens.demoSupport]) {
      expect((await request('/v1/chat/support', token)).status).toBe(403);
      expect((await post('/v1/chat/support/messages', token, { body: 'Oi' })).status).toBe(403);
    }
    expect(await conversationCount(ids.demoAdmin)).toBe(0);
    expect(await conversationCount(ids.demoSupport)).toBe(0);
    // …and a member cannot reach the staff side.
    expect((await request('/v1/chat/inbox', tokens.demoMember)).status).toBe(403);
    expect(
      (
        await post(`/v1/chat/conversations/${SEED_THREAD.id}/messages`, tokens.demoMember, {
          body: 'Oi',
        })
      ).status,
    ).toBe(403);
  });

  it("D-222: a member-facing staff message carries the agent's first name and nothing else", async () => {
    const thread = await get<SupportThread>('/v1/chat/support', tokens.demoMember);
    expect(thread.conversation?.id).toBe(SEED_THREAD.id);
    const staffRow = thread.messages.find((message) => message.side === 'staff');
    expect(staffRow?.author).toEqual({ firstName: 'Carla' });
    const keys = keysDeep(thread);
    for (const forbidden of [
      'avatar',
      'avatarAssetId',
      'email',
      'role',
      'userId',
      'authorUserId',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    const raw = JSON.stringify(thread);
    expect(raw).not.toContain('Rocha');
    expect(raw).not.toContain(ids.demoSupport);
  });

  it('CHAT-03 ordering and adjacency: equal instants break by id, a limit=1 walk visits each once, awaiting at the boundary', async () => {
    const first = await memberWithThread('ordem-a');
    const second = await memberWithThread('ordem-b');
    // A deliberate tie on the instant, far ahead of everything else, so the pair heads the inbox.
    await adminSql`
      update public.chat_conversations set last_message_at = '2999-01-01T00:00:00.123456Z'
       where id in (${first.conversationId}::uuid, ${second.conversationId}::uuid)`;
    const walked = await walkInbox(tokens.demoSupport, 1);
    const walkedIds = walked.map((row) => row.conversationId);
    expect(new Set(walkedIds).size).toBe(walkedIds.length);
    const [total] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support'`;
    expect(walkedIds).toHaveLength(total?.n ?? -1);
    const pair = [first.conversationId, second.conversationId].sort().reverse();
    expect(walkedIds.slice(0, 2)).toEqual(pair);
    // The same order in one page.
    const onePage = await get<InboxPage>('/v1/chat/inbox?limit=50', tokens.demoSupport);
    expect(onePage.items.map((row) => row.conversationId).slice(0, 2)).toEqual(pair);

    // The row: the member, a one-line preview, the side and awaiting.
    const row = onePage.items.find((item) => item.conversationId === first.conversationId);
    expect(row?.member).toMatchObject({ displayName: 'Pessoa ordem-a', state: 'active' });
    expect(row?.member.membershipId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.lastMessage).toEqual({
      seq: 1,
      preview: 'Oi, sou ordem-a.',
      side: 'member',
      authorFirstName: null,
    });
    expect(row?.awaiting).toBe(true);

    // Adjacency: staff_last_read_seq = last_seq is NOT awaiting; last_seq - 1 IS.
    const awaitingOf = async () =>
      (await get<InboxPage>('/v1/chat/inbox?limit=50', tokens.demoSupport)).items.find(
        (item) => item.conversationId === first.conversationId,
      )?.awaiting;
    await adminSql`
      update public.chat_conversations set staff_last_read_seq = last_seq
       where id = ${first.conversationId}::uuid`;
    expect(await awaitingOf()).toBe(false);
    await adminSql`
      update public.chat_conversations set staff_last_read_seq = last_seq - 1
       where id = ${first.conversationId}::uuid`;
    expect(await awaitingOf()).toBe(true);

    // A staff reply at seq N sets both last_seq and staff_last_read_seq to N, and names its author.
    const reply = await post(
      `/v1/chat/conversations/${first.conversationId}/messages`,
      tokens.demoSupport,
      { body: 'Linha um\ncom quebra' },
    );
    expect(reply.status).toBe(201);
    const [counters] = await adminSql<{ last_seq: number; staff_last_read_seq: number }[]>`
      select last_seq::int as last_seq, staff_last_read_seq::int as staff_last_read_seq
        from public.chat_conversations where id = ${first.conversationId}::uuid`;
    expect(counters).toEqual({ last_seq: 2, staff_last_read_seq: 2 });
    const replied = (
      await get<InboxPage>('/v1/chat/inbox?limit=50', tokens.demoSupport)
    ).items.find((item) => item.conversationId === first.conversationId);
    expect(replied?.awaiting).toBe(false);
    expect(replied?.lastMessage).toEqual({
      seq: 2,
      preview: 'Linha um com quebra',
      side: 'staff',
      authorFirstName: 'Carla',
    });
  });

  it('CHAT-03 empty: a tenant with no conversations answers an empty page and a staff count of 0', async () => {
    await adminSql`delete from public.chat_conversations where tenant_id = ${ids.demo}::uuid`;
    try {
      expect(await get('/v1/chat/inbox', tokens.demoSupport)).toEqual({
        items: [],
        nextCursor: null,
      });
      const boot = await bootstrapOf(tokens.demoSupport);
      expect(boot.counters).toMatchObject({ unreadConversations: 0, conversationsBadge: 'count' });
    } finally {
      await restoreSeedThread();
    }
  });

  it('D-225: one staff read clears awaiting for every staff member; a staff reply clears it too', async () => {
    const thread = await memberWithThread('compartilhado');
    const staffCount = async (token: string) =>
      (await bootstrapOf(token)).counters.unreadConversations;
    const before = await staffCount(tokens.demoAdmin);
    expect(await staffCount(tokens.demoSupport)).toBe(before);

    // The support user reads; the ADMIN's count drops too (the position is the team's).
    const read = await post(
      `/v1/chat/conversations/${thread.conversationId}/read`,
      tokens.demoSupport,
      {
        seq: 1,
      },
    );
    expect(read.status).toBe(204);
    expect(await staffCount(tokens.demoAdmin)).toBe(before - 1);
    expect(await staffCount(tokens.demoSupport)).toBe(before - 1);
    // A read never moves backwards nor past the latest message.
    expect(
      (
        await post(`/v1/chat/conversations/${thread.conversationId}/read`, tokens.demoAdmin, {
          seq: 0,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await post(`/v1/chat/conversations/${thread.conversationId}/read`, tokens.demoAdmin, {
          seq: 999,
        })
      ).status,
    ).toBe(204);
    const [position] = await adminSql<{ staff_last_read_seq: number }[]>`
      select staff_last_read_seq::int as staff_last_read_seq from public.chat_conversations
       where id = ${thread.conversationId}::uuid`;
    expect(position?.staff_last_read_seq).toBe(1);

    // The member writes again (awaiting), then the ADMIN replies: cleared for the support user too.
    expect(
      (await post('/v1/chat/support/messages', thread.token, { body: 'Mais uma coisa.' })).status,
    ).toBe(201);
    expect(await staffCount(tokens.demoSupport)).toBe(before);
    expect(
      (
        await post(`/v1/chat/conversations/${thread.conversationId}/messages`, tokens.demoAdmin, {
          body: 'Respondido.',
        })
      ).status,
    ).toBe(201);
    expect(await staffCount(tokens.demoSupport)).toBe(before - 1);

    // A malformed read is a 400; a foreign member's read of this thread is a bare 404.
    expect(
      (
        await post(`/v1/chat/conversations/${thread.conversationId}/read`, tokens.demoSupport, {
          seq: -1,
        })
      ).status,
    ).toBe(400);
    const foreign = await post(
      `/v1/chat/conversations/${thread.conversationId}/read`,
      tokens.demoMember,
      { seq: 1 },
    );
    expect(foreign.status).toBe(404);
  });

  it("CHAT-05 / D-237: the member's dot is 1 after a staff reply and 0 after the member's read", async () => {
    const thread = await memberWithThread('ponto');
    expect((await bootstrapOf(thread.token)).counters).toMatchObject({
      unreadConversations: 0,
      conversationsBadge: 'dot',
    });
    const reply = await post(
      `/v1/chat/conversations/${thread.conversationId}/messages`,
      tokens.demoSupport,
      { body: 'Chegou a resposta.' },
    );
    expect(reply.status).toBe(201);
    const replySeq = ((await reply.json()) as SendResult).message.seq;
    expect((await bootstrapOf(thread.token)).counters).toMatchObject({
      unreadConversations: 1,
      conversationsBadge: 'dot',
    });
    // /v1/me/counters agrees with the bootstrap.
    const live = await get<Counters>('/v1/me/counters', thread.token);
    expect(live).toEqual({
      unreadNotifications: live.unreadNotifications,
      unreadConversations: 1,
      conversationsBadge: 'dot',
    });

    // The member's detail and read.
    expect(await get(`/v1/chat/conversations/${thread.conversationId}`, thread.token)).toEqual({
      viewer: 'member',
      id: thread.conversationId,
      lastSeq: replySeq,
      lastReadSeq: 0,
      lastStaffSeq: replySeq,
    });
    const read = await post(`/v1/chat/conversations/${thread.conversationId}/read`, thread.token, {
      seq: replySeq,
    });
    expect(read.status).toBe(204);
    expect((await bootstrapOf(thread.token)).counters.unreadConversations).toBe(0);

    // The staff side of the same thread: the member behind it and the team's position.
    const detail = await get<ConversationDetail>(
      `/v1/chat/conversations/${thread.conversationId}`,
      tokens.demoSupport,
    );
    expect(detail).toMatchObject({
      viewer: 'staff',
      id: thread.conversationId,
      lastSeq: replySeq,
      staffLastReadSeq: replySeq,
      member: { displayName: 'Pessoa ponto', state: 'active' },
    });
    // The staff badge is a count (D-238).
    expect((await bootstrapOf(tokens.demoSupport)).counters.conversationsBadge).toBe('count');
  });

  it('blocked and departed members: staff still read the thread, a reply is 409 member_blocked / member_removed', async () => {
    const thread = await memberWithThread('bloqueado');
    try {
      await adminSql`
        update public.memberships set blocked_at = now(), status = 'blocked'
         where tenant_id = ${ids.demo}::uuid and user_id = ${thread.id}::uuid`;
      const blocked = await post(
        `/v1/chat/conversations/${thread.conversationId}/messages`,
        tokens.demoSupport,
        { body: 'Oi?' },
      );
      expect(blocked.status).toBe(409);
      expect(
        ((await blocked.json()) as { error: { code: string; details: unknown } }).error,
      ).toMatchObject({ code: 'CONFLICT', details: { chat: 'member_blocked' } });
      // Read-only, never hidden: the messages, the detail and the team's read still work.
      expect(
        (
          await request(
            `/v1/chat/conversations/${thread.conversationId}/messages`,
            tokens.demoSupport,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await get<ConversationDetail>(
            `/v1/chat/conversations/${thread.conversationId}`,
            tokens.demoSupport,
          )
        ).viewer === 'staff',
      ).toBe(true);
      expect(
        (
          await post(`/v1/chat/conversations/${thread.conversationId}/read`, tokens.demoSupport, {
            seq: 1,
          })
        ).status,
      ).toBe(204);
      const blockedRow = (
        await get<InboxPage>('/v1/chat/inbox?limit=50', tokens.demoSupport)
      ).items.find((item) => item.conversationId === thread.conversationId);
      expect(blockedRow?.member).toMatchObject({
        state: 'blocked',
        displayName: 'Pessoa bloqueado',
      });

      await adminSql`
        update public.memberships set blocked_at = null, status = 'active', deleted_at = now()
         where tenant_id = ${ids.demo}::uuid and user_id = ${thread.id}::uuid`;
      const removed = await post(
        `/v1/chat/conversations/${thread.conversationId}/messages`,
        tokens.demoSupport,
        { body: 'Oi?' },
      );
      expect(removed.status).toBe(409);
      expect(((await removed.json()) as { error: { details: unknown } }).error.details).toEqual({
        chat: 'member_removed',
      });
      const removedRow = (
        await get<InboxPage>('/v1/chat/inbox?limit=50', tokens.demoSupport)
      ).items.find((item) => item.conversationId === thread.conversationId);
      expect(removedRow?.member).toEqual({
        membershipId: null,
        displayName: null,
        avatarAssetId: null,
        state: 'removed',
      });
      // Nothing was written by either refusal.
      expect(await seqsOf(thread.conversationId)).toEqual([1]);
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null, status = 'active', deleted_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${thread.id}::uuid`;
    }
  });

  it('D-228 / D-235: a staff reply pushes the member and a member message pushes the team, with no bell row', async () => {
    const thread = await memberWithThread('push');
    const memberEndpoint = `${FAKE_PUSH}/sub/chat-${randomUUID()}`;
    const staffEndpoint = `${FAKE_PUSH}/sub/chat-${randomUUID()}`;
    const subscribe = (token: string, endpoint: string) =>
      post('/v1/notifications/push-subscriptions', token, { endpoint, keys: deviceKeys() });
    try {
      expect((await subscribe(thread.token, memberEndpoint)).status).toBe(204);
      expect((await subscribe(tokens.demoSupport, staffEndpoint)).status).toBe(204);
      await closeWaitingFanouts();

      // 1. The support user replies: ONE push job for the member, titled for the team.
      const reply = await post(
        `/v1/chat/conversations/${thread.conversationId}/messages`,
        tokens.demoSupport,
        { body: 'Oi! Já estamos vendo isso.' },
      );
      expect(reply.status).toBe(201);
      const replyId = ((await reply.json()) as SendResult).message.id;
      expect(await runNotificationJobs(ids.demo)).toBe(1);
      const replyJobs = (await pushSendJobsOf(ids.demo)).filter(
        (job) => job.data.dedupeKey === `chat.support_reply:${replyId}`,
      );
      expect(replyJobs).toHaveLength(1);
      expect(replyJobs[0]?.data).toMatchObject({
        kind: 'chat.support_reply',
        userIds: [thread.id],
        push: {
          title: 'team',
          body: 'Oi! Já estamos vendo isso.',
          url: '/suporte',
          tag: thread.conversationId.replaceAll('-', ''),
          topic: thread.conversationId.replaceAll('-', ''),
          urgency: 'high',
          renotify: true,
          ttlSeconds: 259_200,
        },
      });

      // 2. The member writes: ONE push job for the team (the support user has a device), never the
      //    author, with the member's name and the preview.
      const sent = await post('/v1/chat/support/messages', thread.token, { body: 'Obrigado!' });
      expect(sent.status).toBe(201);
      const sentId = ((await sent.json()) as SendResult).message.id;
      expect(await runNotificationJobs(ids.demo)).toBe(1);
      const teamJobs = (await pushSendJobsOf(ids.demo)).filter(
        (job) => job.data.dedupeKey === `chat.member_message:${sentId}`,
      );
      expect(teamJobs).toHaveLength(1);
      expect(teamJobs[0]?.data.userIds).toContain(ids.demoSupport);
      expect(teamJobs[0]?.data.userIds).not.toContain(thread.id);
      expect(teamJobs[0]?.data.push).toMatchObject({
        title: 'tenant',
        body: 'Nova mensagem de Pessoa push: Obrigado!',
        url: `/suporte/${thread.conversationId}`,
      });

      // 3. Neither wrote a bell row (D-228: push-only).
      const [rows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.notifications
         where tenant_id = ${ids.demo}::uuid and kind like 'chat.%'`;
      expect(rows?.n).toBe(0);
    } finally {
      await adminSql`
        delete from public.push_subscriptions
         where endpoint in (${memberEndpoint}, ${staffEndpoint})`;
      await adminSql`
        update pgboss.job_common set state = 'completed', completed_on = now()
         where name = 'notifications.push-send' and state = 'created'
           and data->>'tenantId' = ${ids.demo}`;
    }
  });

  it('D-223: with chat disabled, the admin loses chat.support, the slot leaves the nav and /v1/chat answers 404', async () => {
    try {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${ids.demo}::uuid and module_key = 'chat'`;
      moduleFlags.invalidate(ids.demo);
      const admin = await bootstrapOf(tokens.demoAdmin);
      expect(admin.permissions).not.toContain('chat.support');
      expect(admin.modules.map((module) => module.key)).not.toContain('chat');
      expect(admin.counters.conversationsBadge).toBe('count');
      const support = await bootstrapOf(tokens.demoSupport);
      expect(support.permissions).not.toContain('chat.support');
      const member = await bootstrapOf(tokens.demoMember);
      expect(member.permissions).not.toContain('chat.support.contact');
      expect(member.counters).toMatchObject({
        unreadConversations: 0,
        conversationsBadge: 'count',
      });
      for (const [path, token] of [
        ['/v1/chat/inbox', tokens.demoSupport],
        ['/v1/chat/support', tokens.demoMember],
        [`/v1/chat/conversations/${SEED_THREAD.id}/messages`, tokens.demoMember],
      ] as const) {
        const res = await request(path, token);
        expect(res.status, path).toBe(404);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'MODULE_DISABLED',
        );
      }
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${ids.demo}::uuid and module_key = 'chat'`;
      moduleFlags.invalidate(ids.demo);
    }
    // Positive control: back on, the admin answers support again.
    expect((await bootstrapOf(tokens.demoAdmin)).permissions).toContain('chat.support');
  });

  it('RESEARCH Pitfall 4: the TypeScript chat.support roles equal the SQL staff literal lists', async () => {
    const allKeys = new Set<ModuleKey>(TOGGLEABLE_MODULES);
    const typescriptRoles = TENANT_ROLES.filter((role) =>
      permissionsFor(role, allKeys).includes('chat.support'),
    );
    const literalRoles = (text: string, pattern: RegExp): string[] => {
      const match = pattern.exec(text);
      if (!match?.[1]) throw new Error(`no staff role literal in: ${text.slice(0, 200)}`);
      return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '').sort();
    };
    const policies = await adminSql<{ policyname: string; qual: string }[]>`
      select policyname, qual from pg_policies
       where schemaname = 'public'
         and policyname in ('chat_conversations_access', 'chat_participants_access')`;
    expect(policies).toHaveLength(2);
    const [definer] = await adminSql<{ body: string }[]>`
      select pg_get_functiondef('app.realtime_topic_allowed(text)'::regprocedure) as body`;
    const sources = [
      ...policies.map((policy) =>
        literalRoles(policy.qual, /tenant_role\(\) = ANY \(ARRAY\[(.+?)\]\)/),
      ),
      literalRoles(definer?.body ?? '', /v_role in \(([^)]+)\)/),
    ];
    for (const roles of sources) expect(roles).toEqual([...typescriptRoles].sort());
    expect([...typescriptRoles].sort()).toEqual(['admin_tenant', 'support_tenant']);
  });
});
