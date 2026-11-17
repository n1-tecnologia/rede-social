import type { SendResult, SupportThread } from '@rede-social/module-chat/contracts';
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
    // The shipped answer shape is unchanged: no `case` key yet.
    expect(Object.keys(result).sort()).toEqual(['conversationId', 'message']);

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
