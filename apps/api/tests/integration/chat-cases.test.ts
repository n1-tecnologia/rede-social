import type { SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
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
