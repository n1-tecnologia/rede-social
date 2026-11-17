import { createECDH, randomBytes, randomUUID } from 'node:crypto';
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
import { adminSql, pushSendJobsOf, runNotificationJobs } from './setup';

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
  if (endpoints.length > 0) {
    await adminSql`delete from public.push_subscriptions where endpoint = any(${endpoints}::text[])`;
  }
  await closeWaitingJobs();
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

/* -- the push words (Task 2) ------------------------------------------------------------------------- */

const FAKE_PUSH = 'https://push.fake.test';
const endpoints: string[] = [];

const deviceKeys = (): { p256dh: string; auth: string } => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
};

/** One push device for the caller, through the real route (the shape of `chat-cases-notices.test.ts`). */
async function subscribeDevice(token: string, label: string): Promise<void> {
  const endpoint = `${FAKE_PUSH}/sub/previews-${label}-${randomUUID()}`;
  endpoints.push(endpoint);
  const res = await request('/v1/notifications/push-subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({ endpoint, keys: deviceKeys(), userAgent: 'vitest' }),
  });
  expect(res.status).toBeLessThan(300);
}

async function closeWaitingJobs(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('notifications.fanout', 'notifications.push-send') and state = 'created'`;
}

async function caseNumberOf(conversationId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select case_number::int as n from public.chat_conversations where id = ${conversationId}::uuid`;
  return row?.n ?? -1;
}

/** The push-send jobs of the demo tenant for ONE dedupe key. */
async function jobsFor(tenantId: string, dedupeKey: string) {
  return (await pushSendJobsOf(tenantId)).filter((job) => job.data.dedupeKey === dedupeKey);
}

describe('voice push words', () => {
  it('the team reads "Novo chamado #N de {member}: Mensagem de voz · 0:02" and the member reads the reply as the preview alone (D-860, VOICE-29)', async () => {
    const { tokens, ids } = await caseKit();
    await subscribeDevice(tokens.demoSupport, 'support');
    await subscribeDevice(tokens.demoAdmin, 'admin');
    const member = await throwawayMember('push-voice');
    memberIds.push(member.id);
    await subscribeDevice(member.token, 'member');
    await closeWaitingJobs();

    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const sent = await post('/v1/chat/support/voice-messages', member.token, { mediaId });
    expect(sent.status).toBe(201);
    const first = (await sent.json()) as SendResult;
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const number = await caseNumberOf(first.conversationId);
    const jobs = await jobsFor(ids.demo, `chat.case_new:${first.message.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.userIds).toEqual(expect.arrayContaining([ids.demoSupport, ids.demoAdmin]));
    expect(jobs[0]?.data.userIds).not.toContain(member.id);
    expect(jobs[0]?.data.push).toMatchObject({
      title: 'tenant',
      body: `Novo chamado #${number} de Pessoa push-voice: Mensagem de voz · 0:02`,
      url: `/suporte/${first.conversationId}`,
    });

    // The team answers with a recording: the member's body is the preview alone, nothing else.
    await closeWaitingJobs();
    const replyAsset = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const reply = await post(
      `/v1/chat/conversations/${first.conversationId}/voice-messages`,
      tokens.demoSupport,
      { mediaId: replyAsset },
    );
    expect(reply.status).toBe(201);
    const replied = (await reply.json()) as SendResult;
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const back = await jobsFor(ids.demo, `chat.support_reply:${replied.message.id}`);
    expect(back).toHaveLength(1);
    expect(back[0]?.data.userIds).toEqual([member.id]);
    expect(back[0]?.data.push).toMatchObject({
      title: 'team',
      body: 'Mensagem de voz · 0:02',
      url: '/suporte',
    });

    // The same member writes a second recording on the open case: "Nova mensagem de ... no chamado #N: ...".
    await closeWaitingJobs();
    const secondAsset = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const second = await post('/v1/chat/support/voice-messages', member.token, {
      mediaId: secondAsset,
    });
    expect(second.status).toBe(201);
    const secondResult = (await second.json()) as SendResult;
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const more = await jobsFor(ids.demo, `chat.member_message:${secondResult.message.id}`);
    expect(more).toHaveLength(1);
    expect(more[0]?.data.push).toMatchObject({
      body: `Nova mensagem de Pessoa push-voice no chamado #${number}: Mensagem de voz · 0:02`,
    });

    // Chat messages stay push-only: no bell row exists for a voice message, in either direction.
    const [bell] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${ids.demo}::uuid and kind like 'chat.%' and kind <> 'chat.case_resolved'`;
    expect(bell?.n).toBe(0);
  });
});

/* -- a deleted recording (Task 3, D-868) ------------------------------------------------------------- */

/** The effect of plan 08 on the asset: soft-deleted through the admin lane. The message row stays. */
const retireAsset = (mediaId: string) => adminSql`
  update public.media_assets set deleted_at = now() where id = ${mediaId}::uuid`;

describe('voice previews of a deleted recording', () => {
  it('the inbox row and the card keep the length and say deleted; the label stays on every surface (D-868, VOICE-28, D-861)', async () => {
    const { tokens } = await caseKit();
    const { member, mediaId, conversationId } = await voiceCase('prev-gone');
    await retireAsset(mediaId);

    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.lastMessage?.preview).toBe('');
    expect(row?.lastMessage?.voiceSeconds).toBe(2);
    expect(row?.lastMessage?.voiceDeleted).toBe(true);
    expect(row?.case?.subjectLabel).toBe(VOICE_LABEL);

    const mine = await myCases(member.token);
    expect(mine.current?.lastMessage?.preview).toBe('');
    expect(mine.current?.lastMessage?.voiceSeconds).toBe(2);
    expect(mine.current?.lastMessage?.voiceDeleted).toBe(true);
    expect(mine.current?.subjectLabel).toBe(VOICE_LABEL);

    // The member's two reads of the case header, and the staff thread header.
    const thread = await request('/v1/chat/support', member.token);
    expect(((await thread.json()) as SupportThread).case?.subjectLabel).toBe(VOICE_LABEL);
    const detail = await request(`/v1/chat/conversations/${conversationId}`, member.token);
    const read = (await detail.json()) as ConversationDetail;
    expect(read.viewer === 'member' ? read.case?.subjectLabel : null).toBe(VOICE_LABEL);
    const header = await request(`/v1/chat/conversations/${conversationId}`, tokens.demoSupport);
    const staff = (await header.json()) as ConversationDetail;
    expect(staff.viewer === 'staff' ? staff.case?.subjectLabel : null).toBe(VOICE_LABEL);

    // Closed, then a second case: the earlier-cases list and the closed card still say the label.
    await closeCase(conversationId);
    const closed = await myCases(member.token);
    expect(closed.items[0]?.subjectLabel).toBe(VOICE_LABEL);
    expect(closed.items[0]?.lastMessage?.voiceDeleted).toBe(true);
    const second = await post('/v1/chat/support/messages', member.token, { body: 'Outro assunto' });
    const secondId = ((await second.json()) as SendResult).conversationId;
    const history = await request(
      `/v1/chat/conversations/${secondId}/case/history`,
      tokens.demoSupport,
    );
    const earlier = ((await history.json()) as CaseHistory).earlierCases;
    expect(earlier.find((c) => c.id === conversationId)?.subjectLabel).toBe(VOICE_LABEL);
  });

  it('a text reply after a deleted recording makes the preview text again, with no voice key', async () => {
    const { tokens } = await caseKit();
    const { member, mediaId, conversationId } = await voiceCase('prev-gone-text');
    await retireAsset(mediaId);
    const sent = await post('/v1/chat/support/messages', member.token, { body: 'Escrevo agora' });
    expect(sent.status).toBe(201);
    const row = await inboxRow(tokens.demoSupport, conversationId);
    expect(row?.lastMessage?.preview).toBe('Escrevo agora');
    expect(row?.lastMessage && 'voiceSeconds' in row.lastMessage).toBe(false);
    expect(row?.lastMessage && 'voiceDeleted' in row.lastMessage).toBe(false);
  });

  it('no push is produced for a send whose recording is already gone, and no length leaks (T-12.5-38)', async () => {
    const { tokens, ids } = await caseKit();
    await subscribeDevice(tokens.demoSupport, 'support-gone');
    await closeWaitingJobs();
    const { mediaId, messageId } = await voiceCase('prev-gone-push');
    await retireAsset(mediaId);
    await runNotificationJobs(ids.demo);
    expect(await jobsFor(ids.demo, `chat.case_new:${messageId}`)).toHaveLength(0);
    const leaked = (await pushSendJobsOf(ids.demo)).filter((job) =>
      JSON.stringify(job.data.push ?? {}).includes('Mensagem de voz'),
    );
    expect(leaked.filter((job) => job.data.dedupeKey.endsWith(messageId))).toHaveLength(0);
  });
});
