import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { SendResult, SupportThread } from '@rede-social/module-chat/contracts';
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
 * The staff's voice reply, end to end against the live local stack (Phase 12.5, plan 06; D-806, D-847, D-862,
 * D-866; VOICE-18, VOICE-32, VOICE-34).
 *
 * `voice reply tracer` is ONE path through every layer: a throwaway member opens a case by text, the demo support
 * user uploads a recording to the real Storage (the derive job runs in-process with the real ffmpeg) and posts
 * `POST /v1/chat/conversations/{id}/voice-messages`; the case is taken and the member reads the bubble.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const memberIds: string[] = [];

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

const replyVoice = (token: string, conversationId: string, body: unknown) =>
  post(`/v1/chat/conversations/${conversationId}/voice-messages`, token, body);

/** A throwaway member with a first TEXT message sent: their case, still open and unowned. */
async function openedCase(label: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  const sent = await post('/v1/chat/support/messages', member.token, { body: 'Preciso de ajuda' });
  expect(sent.status).toBe(201);
  const result = (await sent.json()) as SendResult;
  return { member, conversationId: result.conversationId };
}

const stateOf = async (conversationId: string) => {
  const [row] = await adminSql<{ state: string; owner: string | null }[]>`
    select state, owner_user_id::text as owner
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

describe('voice reply tracer', () => {
  it('the team replies with a recording, takes the case and the member reads the bubble (D-806, D-847, D-866)', async () => {
    const { ids, tokens } = await caseKit();
    const { member, conversationId } = await openedCase('voice-reply-tracer');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');

    const reply = await replyVoice(tokens.demoSupport, conversationId, { mediaId });
    expect(reply.status).toBe(201);
    const result = (await reply.json()) as SendResult;
    expect(result.conversationId).toBe(conversationId);
    expect(result.message.side).toBe('staff');
    expect(result.message.body).toBe('');
    expect(result.message.voice?.mediaId).toBe(mediaId);
    expect(result.message.voice?.durationSeconds).toBe(2);
    expect(result.message.author?.firstName).toBeTruthy();
    expect(result.message.authorIsViewer).toBe(true);

    // Taken exactly as a text reply takes it: in progress, owned by the author, one `taken` event.
    expect(await stateOf(conversationId)).toEqual({ state: 'in_progress', owner: ids.demoSupport });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'taken', actor: ids.demoSupport, message_id: result.message.id },
    ]);

    // The member reads the bubble on the OTHER side, with the staff first name projected as for text.
    const thread = await request('/v1/chat/support', member.token);
    expect(thread.status).toBe(200);
    const read = (await thread.json()) as SupportThread;
    const bubble = read.messages.find((m) => m.id === result.message.id);
    expect(bubble?.side).toBe('staff');
    expect(bubble?.voice?.mediaId).toBe(mediaId);
    expect(bubble?.author?.firstName).toBe(result.message.author?.firstName);
    expect(bubble?.authorIsViewer).toBe(false);

    // The admin lane: a null body and the duration copied from the asset.
    const [row] = await adminSql<{ body: string | null; voice_seconds: number; side: string }[]>`
      select body, voice_seconds, author_side as side
        from public.chat_messages where id = ${result.message.id}::uuid`;
    expect(row).toEqual({ body: null, voice_seconds: 2, side: 'staff' });
  });
});
