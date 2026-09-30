import type { MessagePage, SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

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
