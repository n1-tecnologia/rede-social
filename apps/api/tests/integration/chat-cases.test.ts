import { readFileSync } from 'node:fs';
import {
  CASE_ACTIVE_STATES,
  type SendResult,
  type SupportThread,
} from '@rede-social/module-chat/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
  request,
  SEED_THREAD,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { adminSql } from './setup';

/**
 * The support case, end to end against the live local stack (Phase 12.4, plan 01).
 *
 * `case tracer` (CASE-01, CASE-02, D-836, D-837): a member's FIRST message goes through the shipped
 * route and the shipped service with the API code UNCHANGED, and the database turns the new support
 * conversation into a numbered, born-open case with one `opened` event. The number is read through the
 * admin lane as an integer and asserted RELATIVE to the tenant's highest number, because the counter is
 * never reset (numbers keep rising across files and runs).
 *
 * `case activation` (plan 02, CASE-03, CASE-21, D-801, D-802, D-814): after the activation migration a
 * member whose case was closed gets the NEXT numbered case on the next message, and no support
 * conversation is left without a state. (The pre-activation proof of plan 01, a conversation with all
 * case columns null still taking messages, is retired: the validated support-state constraint now
 * refuses such a row, and pgTAP 235 section 5 keeps proving the trigger branch.)
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeThrowaways();
});

describe('case tracer', () => {
  it('a first member message becomes a numbered open case with its opened event', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('tracer');

    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Preciso de ajuda',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    // The shipped keys stay; the optional `case` is added by plan 06.
    expect(Object.keys(result).sort()).toEqual(['case', 'conversationId', 'message']);

    const [row] = await adminSql<
      {
        case_number: number;
        state: string;
        priority: string;
        category: string;
        owner: string | null;
      }[]
    >`
      select case_number, state, priority, category, owner_user_id::text as owner
        from public.chat_conversations
       where id = ${result.conversationId}::uuid`;
    expect(row?.case_number).toBe(base + 1);
    expect(Number.isInteger(row?.case_number)).toBe(true);
    expect(row?.state).toBe('open');
    expect(row?.priority).toBe('normal');
    expect(row?.category).toBe('other');
    expect(row?.owner).toBeNull();

    const events = await adminSql<
      { kind: string; actor: string | null; to_state: string | null }[]
    >`
      select kind, actor_user_id::text as actor, to_state
        from public.chat_case_events
       where conversation_id = ${result.conversationId}::uuid
       order by created_at, id`;
    expect(events).toEqual([{ kind: 'opened', actor: member.id, to_state: 'open' }]);
  });
});

describe('case first message', () => {
  const conversationRows = (memberId: string) =>
    adminSql<{ id: string }[]>`
      select id::text as id from public.chat_conversations
       where kind = 'support' and created_by_user_id = ${memberId}::uuid`;

  it('tracer: a first message with a category and a subject opens a case the thread read returns (D-812, D-811, D-839, CASE-10, CASE-15)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('first-fields');

    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Fui cobrado duas vezes no cartão',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    // The shipped keys stay and the optional `case` is added.
    expect(Object.keys(result).sort()).toEqual(['case', 'conversationId', 'message']);
    expect(result.case).toEqual({
      id: result.conversationId,
      number: base + 1,
      state: 'open',
      opened: true,
      reopened: false,
    });

    const read = await request('/v1/chat/support', member.token);
    expect(read.status).toBe(200);
    const thread = (await read.json()) as SupportThread;
    expect(thread.conversation?.id).toBe(result.conversationId);
    expect(thread.hasAnyCase).toBe(true);
    expect(thread.case).toMatchObject({
      id: result.conversationId,
      number: base + 1,
      state: 'open',
      subject: 'Cobrança duplicada',
      subjectLabel: 'Cobrança duplicada',
      category: 'payment',
    });
    expect(thread.case).not.toHaveProperty('priority');
    expect(thread.case).not.toHaveProperty('ownerUserId');

    // A second message from the same member lands in the same case and ignores the new fields.
    const again = await post('/v1/chat/support/messages', member.token, {
      body: 'Mais uma informação',
      category: 'account',
      subject: 'Outro assunto',
    });
    expect(again.status).toBe(201);
    const second = (await again.json()) as SendResult;
    expect(second.conversationId).toBe(result.conversationId);
    expect(second.case).toMatchObject({ number: base + 1, opened: false, reopened: false });
    const [stored] = await adminSql<
      { category: string; subject: string | null; priority: string }[]
    >`
      select category, subject, priority from public.chat_conversations
       where id = ${result.conversationId}::uuid`;
    expect(stored).toEqual({
      category: 'payment',
      subject: 'Cobrança duplicada',
      priority: 'normal',
    });
  });

  it('a body carrying priority, state or owner is a 400 and writes no conversation (D-812, T-12.4-25)', async () => {
    const member = await throwawayMember('forged');
    for (const forged of [{ priority: 'high' }, { state: 'closed' }, { owner: member.id }]) {
      const refused = await post('/v1/chat/support/messages', member.token, {
        body: 'Quero prioridade',
        category: 'payment',
        ...forged,
      });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(await conversationRows(member.id)).toEqual([]);
  });
});

describe('case numbering', () => {
  it('two members opening in two committed transactions get consecutive numbers (EP-006)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const first = await throwawayMember('number-a');
    const second = await throwawayMember('number-b');

    const a = await post('/v1/chat/support/messages', first.token, { body: 'Primeiro' });
    const b = await post('/v1/chat/support/messages', second.token, { body: 'Segundo' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [one, two] = [(await a.json()) as SendResult, (await b.json()) as SendResult];

    const rows = await adminSql<{ id: string; case_number: number }[]>`
      select id::text as id, case_number
        from public.chat_conversations
       where id in (${one.conversationId}::uuid, ${two.conversationId}::uuid)`;
    const numberOf = (id: string) => rows.find((r) => r.id === id)?.case_number;
    expect(numberOf(one.conversationId)).toBe(base + 1);
    expect(numberOf(two.conversationId)).toBe(base + 2);
  });
});

describe('case activation', () => {
  it('after a case is closed the next member message opens the next numbered case', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('activation');

    const first = await post('/v1/chat/support/messages', member.token, {
      body: 'Primeiro chamado',
    });
    expect(first.status).toBe(201);
    const one = (await first.json()) as SendResult;

    // The admin lane closes it (the staff action arrives with plan 05; this is the same row change).
    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${one.conversationId}::uuid`;

    const second = await post('/v1/chat/support/messages', member.token, { body: 'Outro assunto' });
    expect(second.status).toBe(201);
    const two = (await second.json()) as SendResult;
    expect(two.conversationId).not.toBe(one.conversationId);
    expect(two.message.seq).toBe(1);

    const rows = await adminSql<{ id: string; case_number: number; state: string }[]>`
      select id::text as id, case_number, state
        from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and created_by_user_id = ${member.id}::uuid
       order by case_number`;
    expect(rows.map((r) => [r.id, r.case_number, r.state])).toEqual([
      [one.conversationId, base + 1, 'closed'],
      [two.conversationId, base + 2, 'open'],
    ]);
    const [opened] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_case_events
       where conversation_id in (${one.conversationId}::uuid, ${two.conversationId}::uuid)
         and kind = 'opened'`;
    expect(opened?.n).toBe(2);

    const thread = await request('/v1/chat/support', member.token);
    expect(thread.status).toBe(200);
    expect(((await thread.json()) as SupportThread).conversation?.id).toBe(two.conversationId);
  });

  it('the member send repeats the index predicate to the letter (EP-012, EP-013)', async () => {
    const [index] = await adminSql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where schemaname = 'public' and indexname = 'chat_conversations_one_active_case_per_member'`;
    const listed = /ARRAY\[([^\]]+)\]/.exec(index?.indexdef ?? '')?.[1] ?? '';
    const states = [...listed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    // Exact lowercase literals, in the contract's order: no folding, no trimming (EP-012).
    expect(states).toEqual([...CASE_ACTIVE_STATES]);
    expect(index?.indexdef).toContain("kind = 'support'");

    // The service spells the list ONCE, from the same constant, and nowhere as a second literal (EP-013).
    const source = readFileSync(
      new URL('../../../../packages/modules/chat/server/service.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/where kind = 'support' and state in \(\$\{ACTIVE_CASE_STATES\}\)/);
    expect(source).toContain('CASE_ACTIVE_STATES.map');
    expect(source).not.toMatch(/'open'\s*,\s*'in_progress'/);
  });

  it('the same body sent twice writes two messages in ONE case: messages are not deduplicated (EP-014)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('twice');
    const first = await post('/v1/chat/support/messages', member.token, { body: 'Igual' });
    const second = await post('/v1/chat/support/messages', member.token, { body: 'Igual' });
    expect([first.status, second.status]).toEqual([201, 201]);
    const [a, b] = [(await first.json()) as SendResult, (await second.json()) as SendResult];
    expect(b.conversationId).toBe(a.conversationId);
    expect([a.message.seq, b.message.seq]).toEqual([1, 2]);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support' and created_by_user_id = ${member.id}::uuid`;
    expect(count?.n).toBe(1);
  });

  it('no support conversation has a null state after the activation', async () => {
    const [nulls] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where kind = 'support' and state is null`;
    expect(nulls?.n).toBe(0);
    const [seed] = await adminSql<{ state: string | null; case_number: number | null }[]>`
      select state, case_number from public.chat_conversations
       where id = ${SEED_THREAD.id}::uuid`;
    expect(seed?.state).not.toBeNull();
    expect(seed?.case_number).not.toBeNull();
  });
});

describe('case transitions', () => {
  /** A throwaway member with a first message sent: their case, still open. */
  async function openedCase(label: string) {
    const member = await throwawayMember(label);
    const sent = await post('/v1/chat/support/messages', member.token, {
      body: 'Preciso de ajuda',
    });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    return { member, conversationId: result.conversationId };
  }

  const stateOf = async (conversationId: string) => {
    const [row] = await adminSql<
      { state: string; owner: string | null; resolved: boolean; closed: boolean }[]
    >`
      select state, owner_user_id::text as owner,
             resolved_at is not null as resolved, closed_at is not null as closed
        from public.chat_conversations where id = ${conversationId}::uuid`;
    return row;
  };
  const eventsOf = (conversationId: string) => adminSql<
    { kind: string; actor: string | null; message_id: string | null }[]
  >`
      select kind, actor_user_id::text as actor, message_id::text as message_id
        from public.chat_case_events
       where conversation_id = ${conversationId}::uuid and kind <> 'opened'
       order by created_at, id`;
  const resolveAsAdmin = (conversationId: string, owner: string | null) => adminSql`
      update public.chat_conversations
         set state = 'resolved', resolved_at = now(), owner_user_id = ${owner}::uuid
       where id = ${conversationId}::uuid`;

  it('a member reply on a resolved case reopens it, a body of one emoji is enough (D-805, EP-022)', async () => {
    const { ids } = await caseKit();
    const { member, conversationId } = await openedCase('reopen');
    await resolveAsAdmin(conversationId, ids.demoSupport);

    const sent = await post('/v1/chat/support/messages', member.token, { body: '😀' });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    expect(result.conversationId).toBe(conversationId);

    expect(await stateOf(conversationId)).toEqual({
      state: 'open',
      owner: null,
      resolved: false,
      closed: false,
    });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'reopened', actor: member.id, message_id: result.message.id },
    ]);
  });

  it('a staff reply on an unowned open case takes it for the author (D-806)', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('take');

    const reply = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
      {
        body: 'Vou cuidar disso',
      },
    );
    expect(reply.status).toBe(201);
    const result = (await reply.json()) as SendResult;

    expect(await stateOf(conversationId)).toEqual({
      state: 'in_progress',
      owner: ids.demoSupport,
      resolved: false,
      closed: false,
    });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'taken', actor: ids.demoSupport, message_id: result.message.id },
    ]);

    // A second reply by someone else changes nothing (any staff member may answer, whoever owns it).
    const other = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoAdmin,
      {
        body: 'Complemento da administração',
      },
    );
    expect(other.status).toBe(201);
    expect((await stateOf(conversationId))?.owner).toBe(ids.demoSupport);
    expect(await eventsOf(conversationId)).toHaveLength(1);
  });

  it('a whitespace-only or oversized body on a resolved case is refused before any transition (EP-021)', async () => {
    const { ids } = await caseKit();
    const { member, conversationId } = await openedCase('refusal');
    await resolveAsAdmin(conversationId, ids.demoSupport);

    const blank = await post('/v1/chat/support/messages', member.token, { body: '  \n\t ' });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: { details: unknown } }).error.details).toEqual({
      chat: 'body_required',
    });
    const long = await post('/v1/chat/support/messages', member.token, {
      body: '😀'.repeat(2001),
    });
    expect(long.status).toBe(400);

    expect((await stateOf(conversationId))?.state).toBe('resolved');
    expect(await eventsOf(conversationId)).toEqual([]);
  });

  it('a staff reply on a closed case is refused and writes nothing (D-845, T-12.4-06)', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('closed');
    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${conversationId}::uuid`;
    const [before] = await adminSql<{ n: number; last_seq: number }[]>`
      select (select count(*)::int from public.chat_messages where conversation_id = c.id) as n,
             c.last_seq::int as last_seq
        from public.chat_conversations c where c.id = ${conversationId}::uuid`;

    const reply = await post(
      `/v1/chat/conversations/${conversationId}/messages`,
      tokens.demoSupport,
      {
        body: 'Resposta tardia',
      },
    );
    // The route maps CS004 in plan 08; here it is only required to be a refusal that wrote nothing.
    expect(reply.status).toBeGreaterThanOrEqual(400);

    const [after] = await adminSql<{ n: number; last_seq: number }[]>`
      select (select count(*)::int from public.chat_messages where conversation_id = c.id) as n,
             c.last_seq::int as last_seq
        from public.chat_conversations c where c.id = ${conversationId}::uuid`;
    expect(after).toEqual(before);
    expect((await stateOf(conversationId))?.state).toBe('closed');
    expect(await eventsOf(conversationId)).toEqual([]);
  });
});

describe('case concurrency', () => {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);

  const sendTwenty = (token: string) =>
    Promise.all(
      range(1, 20).map((n) => post('/v1/chat/support/messages', token, { body: `Mensagem ${n}` })),
    );

  const casesOf = (memberId: string, tenantId: string) =>
    adminSql<{ id: string; case_number: number; state: string; last_seq: number }[]>`
      select id::text as id, case_number, state, last_seq::int as last_seq
        from public.chat_conversations
       where tenant_id = ${tenantId}::uuid and kind = 'support'
         and created_by_user_id = ${memberId}::uuid
       order by case_number`;

  it('20 simultaneous first messages make ONE case with seqs 1..20, and after it is closed 20 more make exactly ONE next case (D-802, EP-015)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('twenty');

    const first = await sendTwenty(member.token);
    expect(first.map((res) => res.status)).toEqual(Array(20).fill(201));
    const firstBodies = (await Promise.all(first.map((res) => res.json()))) as SendResult[];
    const firstCases = await casesOf(member.id, ids.demo);
    expect(firstCases).toHaveLength(1);
    const one = firstCases[0];
    expect(new Set(firstBodies.map((body) => body.conversationId))).toEqual(new Set([one?.id]));
    expect(firstBodies.map((body) => body.message.seq).sort((a, b) => a - b)).toEqual(range(1, 20));
    expect(one?.last_seq).toBe(20);

    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${one?.id ?? ''}::uuid`;

    const second = await sendTwenty(member.token);
    expect(second.map((res) => res.status)).toEqual(Array(20).fill(201));
    const secondBodies = (await Promise.all(second.map((res) => res.json()))) as SendResult[];
    const cases = await casesOf(member.id, ids.demo);
    expect(cases).toHaveLength(2);
    const next = cases[1];
    // One higher than the FIRST case's number, never a literal: the counter is never reset.
    expect(next?.case_number).toBe((one?.case_number ?? 0) + 1);
    expect(new Set(secondBodies.map((body) => body.conversationId))).toEqual(new Set([next?.id]));
    expect(secondBodies.map((body) => body.message.seq).sort((a, b) => a - b)).toEqual(
      range(1, 20),
    );
    expect(cases.map((c) => c.state)).toEqual(['closed', 'open']);
  });

  it('20 different members of one tenant opening together get 20 distinct consecutive numbers (EP-009)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const members: { id: string; token: string }[] = [];
    for (const n of range(1, 20)) members.push(await throwawayMember(`fan-${n}`));

    const results = await Promise.all(
      members.map((member) =>
        post('/v1/chat/support/messages', member.token, { body: 'Abrindo um chamado' }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(20).fill(201));

    const rows = await adminSql<{ case_number: number }[]>`
      select case_number from public.chat_conversations
       where tenant_id = ${ids.demo}::uuid and kind = 'support'
         and created_by_user_id in ${adminSql(members.map((member) => member.id))}
       order by case_number`;
    expect(rows.map((row) => row.case_number)).toEqual(range(base + 1, base + 20));
  });

  it('a member message racing a staff close lands in a NEW case and never in the closed one (D-801, T-12.4-06)', async () => {
    const { ids } = await caseKit();
    const member = await throwawayMember('race');
    const sent = await post('/v1/chat/support/messages', member.token, { body: 'Primeira' });
    expect(sent.status).toBe(201);
    const one = (await sent.json()) as SendResult;

    // A SECOND connection plays the staff close: it takes the conversation row lock and holds it.
    const closer = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const closing = closer.begin(async (tx) => {
      await tx`
        update public.chat_conversations
           set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
         where id = ${one.conversationId}::uuid`;
      locked();
      await held;
    });

    try {
      await lockTaken;
      const racing = post('/v1/chat/support/messages', member.token, {
        body: 'Chegou na hora do fechamento',
      });
      // No sleep: poll the lock table until the member's insert is queued behind the close, then let it commit.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const [waiting] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`;
        if ((waiting?.n ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await closing;
      const answer = await racing;
      expect(answer.status).toBe(201);
      const two = (await answer.json()) as SendResult;
      expect(two.conversationId).not.toBe(one.conversationId);
      expect(two.message.seq).toBe(1);

      const cases = await casesOf(member.id, ids.demo);
      expect(cases.map((c) => [c.id, c.state, c.last_seq])).toEqual([
        [one.conversationId, 'closed', 1],
        [two.conversationId, 'open', 1],
      ]);
      expect(cases[1]?.case_number).toBe((cases[0]?.case_number ?? 0) + 1);
    } finally {
      release();
      await closing.catch(() => undefined);
      await closer.end();
    }
  });
});
