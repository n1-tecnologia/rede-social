import type { SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
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
 * `case legacy rows` (T-12.4-85, a PRE-ACTIVATION proof that plan 02 retires): a conversation whose
 * case columns are all null, which is what every conversation is between this plan and the plan 02
 * backfill, still takes a member message and a staff reply.
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

describe('case legacy rows', () => {
  it('a conversation whose case columns are all null still takes a member message and a staff reply', async () => {
    const { ids, tokens } = await caseKit();
    // The seeded demo thread, made legacy-shaped: every case column null and no history (what every
    // conversation is between plan 01 and the plan 02 backfill). `sweepCases` restores it afterwards.
    await adminSql`
      update public.chat_conversations
         set state = null, case_number = null, priority = null, category = null
       where id = ${SEED_THREAD.id}::uuid`;
    await adminSql`
      delete from public.chat_case_events where conversation_id = ${SEED_THREAD.id}::uuid`;
    const [before] = await adminSql<{ last_seq: number }[]>`
      select last_seq::int as last_seq from public.chat_conversations
       where id = ${SEED_THREAD.id}::uuid`;

    const member = await post('/v1/chat/support/messages', tokens.demoMember, {
      body: 'Mensagem em uma conversa antiga',
    });
    expect(member.status).toBe(201);
    const sent = (await member.json()) as SendResult;
    expect(sent.conversationId).toBe(SEED_THREAD.id);
    expect(sent.message.seq).toBe((before?.last_seq ?? 0) + 1);

    const staff = await post(
      `/v1/chat/conversations/${SEED_THREAD.id}/messages`,
      tokens.demoSupport,
      {
        body: 'Resposta em uma conversa antiga',
      },
    );
    expect(staff.status).toBe(201);
    const reply = (await staff.json()) as SendResult;
    expect(reply.message.seq).toBe((before?.last_seq ?? 0) + 2);

    const [row] = await adminSql<
      { state: string | null; case_number: number | null; events: number }[]
    >`
      select c.state, c.case_number,
             (select count(*)::int from public.chat_case_events e where e.conversation_id = c.id) as events
        from public.chat_conversations c
       where c.id = ${SEED_THREAD.id}::uuid`;
    expect(row).toEqual({ state: null, case_number: null, events: 0 });
    expect(ids.demo).not.toBe('');
  });
});
