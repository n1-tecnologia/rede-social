import type { InboxPage, InboxRow, SendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  highestNumber,
  post,
  removeThrowaways,
  request,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { adminSql } from './setup';

/**
 * The team's side of the support-case read API, end to end against the live local stack (Phase 12.4, plan 07):
 * the inbox with its tabs and filters, the case facts and the list of legal actions, the history with the member's
 * earlier cases and the staff roster (CASE-12, CASE-16, CASE-23; D-805, D-806, D-809, D-842, D-843).
 *
 * The tenant counter is never touched: every number assertion is RELATIVE to `highestNumber`. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeThrowaways();
});

/** The shipped keys of an inbox row, plus the optional `case`. */
const INBOX_ROW_KEYS = [
  'awaiting',
  'case',
  'conversationId',
  'lastMessage',
  'lastMessageAt',
  'member',
];

async function inbox(token: string, query = ''): Promise<InboxPage> {
  const res = await request(`/v1/chat/inbox${query}`, token);
  expect(res.status).toBe(200);
  return (await res.json()) as InboxPage;
}

async function send(token: string, body: Record<string, unknown>): Promise<SendResult> {
  const res = await post('/v1/chat/support/messages', token, body);
  expect(res.status).toBe(201);
  return (await res.json()) as SendResult;
}

const closeAsAdmin = (conversationId: string) => adminSql`
  update public.chat_conversations
     set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
   where id = ${conversationId}::uuid`;

describe('case staff inbox', () => {
  it('tracer: staff reads the default inbox with the case facts, and a closed case leaves the default tab (D-805, CASE-16)', async () => {
    const { tokens, ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('staff-inbox');
    const sent = await send(member.token, {
      body: 'Fui cobrado duas vezes no cartão',
      category: 'payment',
      subject: 'Cobrança duplicada',
    });

    const page = await inbox(tokens.demoSupport, '?limit=50');
    const row = page.items.find((item) => item.conversationId === sent.conversationId);
    expect(row).toBeDefined();
    // The shipped keys stay; the case is the one optional key added to the row.
    expect(Object.keys(row as InboxRow).sort()).toEqual(INBOX_ROW_KEYS);
    expect(row?.case).toEqual({
      number: base + 1,
      state: 'open',
      subjectLabel: 'Cobrança duplicada',
      category: 'payment',
      priority: 'normal',
      ownerName: null,
      ownerIsViewer: false,
    });
    expect(row?.awaiting).toBe(true);

    // The admin lane closes it: the default tab (open and in progress) no longer lists it, `tab=closed` does.
    await closeAsAdmin(sent.conversationId);
    const afterOpen = await inbox(tokens.demoSupport, '?limit=50');
    expect(afterOpen.items.some((item) => item.conversationId === sent.conversationId)).toBe(false);
    const closed = await inbox(tokens.demoSupport, '?tab=closed&limit=50');
    const closedRow = closed.items.find((item) => item.conversationId === sent.conversationId);
    expect(closedRow?.case?.state).toBe('closed');
    expect(closedRow?.awaiting).toBe(false);
    const resolved = await inbox(tokens.demoSupport, '?tab=resolved&limit=50');
    expect(resolved.items.some((item) => item.conversationId === sent.conversationId)).toBe(false);
  });
});
