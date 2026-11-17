import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type {
  CaseHistory,
  ConversationDetail,
  InboxPage,
  MyCasesPage,
  SendResult,
  SupportThread,
} from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseKit,
  post,
  removeThrowaways,
  request,
  sweepCases,
  throwawayMember,
} from './chat-case-fixtures';
import { readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import { adminSql } from './setup';

/**
 * The previews and the case label of a recording, end to end against the live local stack (Phase 12.5, plan 09;
 * D-860, D-861, D-868; VOICE-28, VOICE-29, VOICE-30). The words are built by the host and by one server constant:
 * the API answers FACTS (`voiceSeconds`, `voiceDeleted`) and the constant label of a case opened by voice.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const memberIds: string[] = [];
const VOICE_LABEL = 'Mensagem de voz';

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeVoiceRows(memberIds);
  await removeThrowaways();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

/** A throwaway member who opens a case with a recording (optionally with a typed subject). */
async function voiceCase(label: string, subject?: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
  const res = await post('/v1/chat/support/voice-messages', member.token, {
    mediaId,
    ...(subject !== undefined ? { subject } : {}),
  });
  expect(res.status).toBe(201);
  const result = (await res.json()) as SendResult;
  return { member, mediaId, conversationId: result.conversationId, messageId: result.message.id };
}

/** A throwaway member who opens a case with a text. */
async function textCase(label: string, body: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  const res = await post('/v1/chat/support/messages', member.token, { body });
  expect(res.status).toBe(201);
  const result = (await res.json()) as SendResult;
  return { member, conversationId: result.conversationId };
}

async function inboxRow(staffToken: string, conversationId: string) {
  const res = await request('/v1/chat/inbox?tab=open&limit=50', staffToken);
  expect(res.status).toBe(200);
  const page = (await res.json()) as InboxPage;
  return page.items.find((row) => row.conversationId === conversationId);
}

async function myCases(token: string) {
  const res = await request('/v1/chat/support/cases', token);
  expect(res.status).toBe(200);
  return (await res.json()) as MyCasesPage;
}

const closeCase = (conversationId: string) => adminSql`
  update public.chat_conversations
     set state = 'closed', closed_at = now(), resolved_at = null, staff_last_read_seq = last_seq
   where id = ${conversationId}::uuid`;

describe('voice previews', () => {
  it('tracer: a recording shows its stored length in the inbox row and the card and names the case (D-860, D-861, VOICE-28, VOICE-30)', async () => {
    const { tokens } = await caseKit();
    const { member, conversationId } = await voiceCase('prev-tracer');

    // (a) the staff inbox row: facts, never words, and the constant label.
    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.lastMessage?.preview).toBe('');
    expect(row?.lastMessage?.voiceSeconds).toBe(2);
    expect(row?.lastMessage && 'voiceDeleted' in row.lastMessage).toBe(false);
    expect(row?.case?.subjectLabel).toBe(VOICE_LABEL);

    // (b) the member's own card carries the same facts and the same label.
    const mine = await myCases(member.token);
    expect(mine.current?.lastMessage?.preview).toBe('');
    expect(mine.current?.lastMessage?.voiceSeconds).toBe(2);
    expect(mine.current?.lastMessage && 'voiceDeleted' in mine.current.lastMessage).toBe(false);
    expect(mine.current?.subjectLabel).toBe(VOICE_LABEL);
  });

  it('a case opened by TEXT keeps the cut text and has no voice key (VOICE-04)', async () => {
    const { tokens } = await caseKit();
    const { member, conversationId } = await textCase('prev-text', 'Preciso de ajuda com a compra');
    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.lastMessage?.preview).toBe('Preciso de ajuda com a compra');
    expect(row?.lastMessage && 'voiceSeconds' in row.lastMessage).toBe(false);
    expect(row?.lastMessage && 'voiceDeleted' in row.lastMessage).toBe(false);
    expect(row?.case?.subjectLabel).toBe('Preciso de ajuda com a compra');
    const mine = await myCases(member.token);
    expect(mine.current?.lastMessage?.preview).toBe('Preciso de ajuda com a compra');
    expect(mine.current?.lastMessage && 'voiceSeconds' in mine.current.lastMessage).toBe(false);
  });

  it('a case opened by voice WITH a typed subject keeps the typed subject as the label (D-861)', async () => {
    const { tokens } = await caseKit();
    const { member, conversationId } = await voiceCase('prev-subject', 'Problema no pagamento');
    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.case?.subjectLabel).toBe('Problema no pagamento');
    expect(row?.lastMessage?.voiceSeconds).toBe(2);
    expect((await myCases(member.token)).current?.subjectLabel).toBe('Problema no pagamento');
  });

  it('a text reply after the recording makes the preview the text again: the preview follows the LAST message', async () => {
    const { tokens } = await caseKit();
    const { member, conversationId } = await voiceCase('prev-last');
    const sent = await post('/v1/chat/support/messages', member.token, { body: 'Segue o texto' });
    expect(sent.status).toBe(201);
    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.lastMessage?.preview).toBe('Segue o texto');
    expect(row?.lastMessage && 'voiceSeconds' in row.lastMessage).toBe(false);
    // The label still follows the FIRST message of the case.
    expect(row?.case?.subjectLabel).toBe(VOICE_LABEL);
    const mine = await myCases(member.token);
    expect(mine.current?.lastMessage?.preview).toBe('Segue o texto');
    expect(mine.current?.lastMessage && 'voiceSeconds' in mine.current.lastMessage).toBe(false);
  });

  it('the staff thread header and the earlier-cases list read the voice label (f)', async () => {
    const { tokens } = await caseKit();
    const first = await voiceCase('prev-earlier');
    const header = await request(
      `/v1/chat/conversations/${first.conversationId}`,
      tokens.demoSupport,
    );
    expect(header.status).toBe(200);
    const detail = (await header.json()) as ConversationDetail;
    expect(detail.viewer === 'staff' ? detail.case?.subjectLabel : null).toBe(VOICE_LABEL);

    // Close it, open a second case with a text: the first is an earlier case of the same member.
    await closeCase(first.conversationId);
    const second = await post('/v1/chat/support/messages', first.member.token, {
      body: 'De novo por texto',
    });
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as SendResult).conversationId;
    expect(secondId).not.toBe(first.conversationId);
    const history = await request(
      `/v1/chat/conversations/${secondId}/case/history`,
      tokens.demoSupport,
    );
    expect(history.status).toBe(200);
    const earlier = ((await history.json()) as CaseHistory).earlierCases;
    expect(earlier.find((c) => c.id === first.conversationId)?.subjectLabel).toBe(VOICE_LABEL);
  });

  it('the MEMBER-side label: both reads, with and without a typed subject, and a text case as before (g)', async () => {
    const plain = await voiceCase('prev-member-plain');
    const typed = await voiceCase('prev-member-typed', 'Assunto digitado');
    const text = await textCase('prev-member-text', 'Pergunta por texto');

    for (const [who, expected] of [
      [plain, VOICE_LABEL],
      [typed, 'Assunto digitado'],
      [text, 'Pergunta por texto'],
    ] as const) {
      const thread = await request('/v1/chat/support', who.member.token);
      expect(thread.status).toBe(200);
      expect(((await thread.json()) as SupportThread).case?.subjectLabel).toBe(expected);
      const detail = await request(
        `/v1/chat/conversations/${who.conversationId}`,
        who.member.token,
      );
      expect(detail.status).toBe(200);
      const read = (await detail.json()) as ConversationDetail;
      expect(read.viewer === 'member' ? read.case?.subjectLabel : null).toBe(expected);
    }
  });

  it('a closed voice case still answers the voice label to its member (h)', async () => {
    const { member, conversationId } = await voiceCase('prev-closed');
    await closeCase(conversationId);
    const detail = await request(`/v1/chat/conversations/${conversationId}`, member.token);
    expect(detail.status).toBe(200);
    const read = (await detail.json()) as ConversationDetail;
    expect(read.viewer === 'member' ? read.case?.subjectLabel : null).toBe(VOICE_LABEL);
    const mine = await myCases(member.token);
    expect(mine.items[0]?.subjectLabel).toBe(VOICE_LABEL);
    expect(mine.items[0]?.lastMessage?.voiceSeconds).toBe(2);
  });
});
