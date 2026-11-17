import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { SendResult, SupportThread } from '@rede-social/module-chat/contracts';
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
import { readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import { adminSql } from './setup';

/**
 * The member's voice send, end to end against the live local stack (Phase 12.5, plan 05; D-846, D-861,
 * D-862, D-866; VOICE-04, VOICE-05, VOICE-18, VOICE-31).
 *
 * `voice send tracer` is ONE path through every layer: a throwaway member uploads the WebM fixture to the
 * real Storage, the derive job runs in-process with the real ffmpeg, the member posts
 * `POST /v1/chat/support/voice-messages` and reads the message back from `GET /v1/chat/support`. The case
 * number is asserted RELATIVE to the tenant's highest (the counter is never reset).
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order). Each test's own voice assets are
 * removed AFTER their messages in `afterAll` (`removeVoiceRows`).
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

const sendVoice = (token: string, body: unknown) =>
  post('/v1/chat/support/voice-messages', token, body);

describe('voice send tracer', () => {
  it('a recording becomes the first voice message of a numbered case, once per take (VOICE-04, VOICE-18)', async () => {
    const { ids } = await caseKit();
    const base = await highestNumber(ids.demo);
    const member = await throwawayMember('voice-tracer');
    memberIds.push(member.id);
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');

    const sent = await sendVoice(member.token, { mediaId });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    expect(result.message.body).toBe('');
    expect(result.message.voice?.mediaId).toBe(mediaId);
    expect(result.message.voice?.durationSeconds).toBe(2);
    expect(result.message.voice?.deleted).toBeUndefined();
    expect(result.message.side).toBe('member');
    expect(result.message.seq).toBe(1);
    expect(result.case?.opened).toBe(true);
    expect(result.case?.reopened).toBe(false);
    expect(result.case?.number).toBe(base + 1);

    // The thread route the member already uses reads the recording back with the same `voice`.
    const thread = await request('/v1/chat/support', member.token);
    expect(thread.status).toBe(200);
    const read = (await thread.json()) as SupportThread;
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0]?.id).toBe(result.message.id);
    expect(read.messages[0]?.voice).toEqual(result.message.voice);

    // The admin lane: ONE row, a null body, the duration copied from the asset and the first seq.
    const rows = await adminSql<
      { body: string | null; voice_seconds: number; seq: number; media_asset_id: string }[]
    >`
      select body, voice_seconds, seq::int as seq, media_asset_id::text as media_asset_id
        from public.chat_messages
       where conversation_id = ${result.conversationId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ body: null, voice_seconds: 2, seq: 1, media_asset_id: mediaId });

    // The same take again answers the SAME message and stores nothing new.
    const again = await sendVoice(member.token, { mediaId });
    expect(again.status).toBe(201);
    const second = (await again.json()) as SendResult;
    expect(second.message.id).toBe(result.message.id);
    expect(second.conversationId).toBe(result.conversationId);
    expect(second.case?.opened).toBe(false);
    expect(second.case?.reopened).toBe(false);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages
       where media_asset_id = ${mediaId}::uuid`;
    expect(count?.n).toBe(1);
  });
});
