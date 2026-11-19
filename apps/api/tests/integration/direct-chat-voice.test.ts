import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sqlClient } from '@rede-social/core/db';
import { subscribe } from '@rede-social/core/server/events/bus';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import type { DirectSendResult } from '@rede-social/module-chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, post, removeThrowaways } from './chat-case-fixtures';
import { processingVoiceAsset, readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
import {
  blockUser,
  type DirectMember,
  directMember,
  directRowsOf,
  readMessages,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
  setModule,
  withDirectModules,
} from './direct-fixtures';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Phase 11 plan 12 (CHAT-06; D-734, D-846, D-858, D-867, D-722; T-11-02, T-11-27): the voice message of a direct
 * conversation, through the API against the live local stack.
 *
 * `direct voice tracer`: member A uploads a take, sends it to member B, only the two of them can play it (a third member,
 * `admin_tenant`, `support_tenant` and another tenant's user get the bare 404 of an unknown id), the same take again is
 * the stored message and emits nothing, and every refusal keeps the words of text or of the 12.5 voice send.
 *
 * The recordings are real (a signed upload to the private bucket and the in-process derive with the real ffmpeg), so the
 * suite skips with a message when `ffmpeg` is not on PATH; pgTAP 236 and 240 prove the same gate facts in SQL.
 *
 * FIXTURES. Members are throwaways of the demo tenant with `social` and `chat` switched on for the span. Rows are swept
 * in this order: the pair rows (their messages), then the voice assets, then the users. Test ORDER is load-bearing
 * (`fileParallelism: false`, declaration order).
 */

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (!hasFfmpeg) {
  console.warn(
    'direct-chat-voice: ffmpeg is not on PATH; the voice suites are skipped (pgTAP 236 and 240 cover the gate)',
  );
}
const suite = hasFfmpeg ? describe : describe.skip;

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

let restoreModules: () => Promise<void> = async () => {};
const voiceOwners: string[] = [];

beforeAll(async () => {
  if (!hasFfmpeg) return;
  await caseKit();
  restoreModules = await withDirectModules('demo');
  resetDirectLimiters();
});

afterAll(async () => {
  if (!hasFfmpeg) return;
  await removeDirectRows();
  await removeVoiceRows(voiceOwners);
  await removeThrowaways();
  await restoreModules();
  resetDirectLimiters();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

async function voiceMember(label: string, displayName?: string): Promise<DirectMember> {
  const member = await directMember(label, displayName ? { displayName } : {});
  voiceOwners.push(member.userId);
  return member;
}

const sendDirectVoice = (from: { token: string }, toMembershipId: string, mediaId: string) =>
  post('/v1/chat/direct/voice-messages', from.token, { toMembershipId, mediaId });

/** `GET /v1/media/{id}/original` as `token` on `host`. A 302 carries the signed URL in `Location`. */
const original = (assetId: string, token: string, host: string = HOSTS.demo) =>
  api.request(`/v1/media/${assetId}/original`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

/** The refusal body without its per-request id, to compare two answers byte for byte. */
async function refusal(res: Response) {
  const { error } = (await res.json()) as Envelope & { error: { requestId?: string } };
  const { requestId: _requestId, ...rest } = error as Envelope['error'] & { requestId?: string };
  return rest;
}

/** Asserts a bare 404 identical in status and body to the answer for an id that does not exist. */
async function expectBare404(res: Response, token: string, host: string = HOSTS.demo) {
  expect(res.status).toBe(404);
  const unknown = await original(randomUUID(), token, host);
  expect(unknown.status).toBe(404);
  expect(await refusal(res)).toEqual(await refusal(unknown));
}

function expectSigned302(res: Response, tenantId: string, assetId: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain(
    `/object/sign/media/${tenantId}/media/${assetId}/original`,
  );
}

async function messageCountOf(mediaId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.chat_messages where media_asset_id = ${mediaId}::uuid`;
  return row?.n ?? 0;
}

/** Everything the chat tables hold for the pair of two users, direct only. */
async function pairRows(a: DirectMember, b: DirectMember) {
  const rows = await directRowsOf(a.userId, b.userId);
  return {
    conversations: rows.length,
    messages: rows.reduce((sum, row) => sum + row.messages, 0),
  };
}

suite('direct voice tracer', () => {
  it('1. A sends a recording to B: 201, an empty body, the server-measured length, and both play it', async () => {
    const { ids } = await caseKit();
    const a = await voiceMember('vt1a');
    const b = await voiceMember('vt1b');
    const mediaId = await readyVoiceAsset(a.token, 'voice-2s.webm');

    const sent = await sendDirectVoice(a, b.membershipId, mediaId);
    expect(sent.status).toBe(201);
    expect(sent.headers.get('cache-control')).toBe('no-store');
    const result = (await sent.json()) as DirectSendResult;
    expect(result.created).toBe(true);
    expect(result.message.body).toBe('');
    expect(result.message.voice?.mediaId).toBe(mediaId);
    expect(result.message.voice?.durationSeconds).toBe(2);
    expect(result.message.voice?.deleted).toBeUndefined();
    expect(result.message.side).toBe('member');
    expect(result.message.authorIsViewer).toBe(true);
    expect(result.message.seq).toBe(1);

    // The admin lane: ONE row of kind direct, a null body and the duration copied from the asset.
    const rows = await adminSql<{ body: string | null; voice_seconds: number; kind: string }[]>`
      select m.body, m.voice_seconds, c.kind
        from public.chat_messages m
        join public.chat_conversations c on c.id = m.conversation_id
       where m.conversation_id = ${result.conversationId}::uuid`;
    expect(rows).toEqual([{ body: null, voice_seconds: 2, kind: 'direct' }]);

    // B reads it through the generic message route and plays it; A plays it too.
    const read = await readMessages(b, result.conversationId);
    expect(read.status).toBe(200);
    const items = ((await read.json()) as { items: { id: string; voice?: { mediaId: string } }[] })
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(result.message.id);
    expect(items[0]?.voice?.mediaId).toBe(mediaId);
    expectSigned302(await original(mediaId, b.token), ids.demo, mediaId);
    expectSigned302(await original(mediaId, a.token), ids.demo, mediaId);
  });

  it('2. the gate: a third member, the administrator, the support staff and another tenant get the bare 404 of an unknown id', async () => {
    const { ids, tokens } = await caseKit();
    const a = await voiceMember('vt2a');
    const b = await voiceMember('vt2b');
    const c = await voiceMember('vt2c');
    const mediaId = await readyVoiceAsset(a.token, 'voice-2s.webm');
    expect((await sendDirectVoice(a, b.membershipId, mediaId)).status).toBe(201);

    // The positive controls: the two participants.
    expectSigned302(await original(mediaId, a.token), ids.demo, mediaId);
    expectSigned302(await original(mediaId, b.token), ids.demo, mediaId);

    // The negatives beside them, BEFORE any report: nobody else is signed a link.
    await expectBare404(await original(mediaId, c.token), c.token);
    await expectBare404(await original(mediaId, tokens.demoAdmin), tokens.demoAdmin);
    await expectBare404(await original(mediaId, tokens.demoSupport), tokens.demoSupport);
    const labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
    await expectBare404(await original(mediaId, labMember, HOSTS.lab), labMember, HOSTS.lab);
  });

  it('3. idempotent per take: the same mediaId again is the stored message with created false and emits nothing; two concurrent posts store one', async () => {
    const a = await voiceMember('vt3a');
    const b = await voiceMember('vt3b');
    const mediaId = await readyVoiceAsset(a.token, 'voice-2s.webm');
    const seen: string[] = [];
    const unsubscribe = subscribe('chat.message_sent', async (payload) => {
      seen.push(payload.messageId);
    });
    try {
      const first = await sendDirectVoice(a, b.membershipId, mediaId);
      expect(first.status).toBe(201);
      const one = (await first.json()) as DirectSendResult;
      expect(one.created).toBe(true);
      expect(seen).toEqual([one.message.id]);

      const again = await sendDirectVoice(a, b.membershipId, mediaId);
      expect(again.status).toBe(201);
      const two = (await again.json()) as DirectSendResult;
      expect(two.message.id).toBe(one.message.id);
      expect(two.conversationId).toBe(one.conversationId);
      expect(two.created).toBe(false);
      expect(await messageCountOf(mediaId)).toBe(1);
      expect(seen).toEqual([one.message.id]);

      // Two simultaneous posts of ONE fresh take, into a pair that has no conversation yet: one message, one event.
      const c = await voiceMember('vt3c');
      const d = await voiceMember('vt3d');
      const racing = await readyVoiceAsset(c.token, 'voice-2s.mp4');
      seen.length = 0;
      const [x, y] = await Promise.all([
        sendDirectVoice(c, d.membershipId, racing),
        sendDirectVoice(c, d.membershipId, racing),
      ]);
      expect([x.status, y.status]).toEqual([201, 201]);
      const bodies = [(await x.json()) as DirectSendResult, (await y.json()) as DirectSendResult];
      expect(bodies[0]?.message.id).toBe(bodies[1]?.message.id);
      expect(bodies[0]?.conversationId).toBe(bodies[1]?.conversationId);
      expect(await messageCountOf(racing)).toBe(1);
      expect(seen).toHaveLength(1);
      expect(await directRowsOf(c.userId, d.userId)).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('4. refusals: not ready, invalid, extra key, closed pair, staff, social off, an unknown target', async () => {
    const a = await voiceMember('vt4a');
    const b = await voiceMember('vt4b');
    const other = await voiceMember('vt4o');

    // A take still processing is `voice_not_ready` and creates nothing.
    const processing = await processingVoiceAsset(a.token, 'voice-2s.webm');
    let res = await sendDirectVoice(a, b.membershipId, processing);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error.details).toEqual({ chat: 'voice_not_ready' });
    expect(await pairRows(a, b)).toEqual({ conversations: 0, messages: 0 });

    // Another member's take, a soft-deleted one and an unknown id are ONE `voice_invalid`.
    const others = await readyVoiceAsset(other.token, 'voice-2s.webm');
    res = await sendDirectVoice(a, b.membershipId, others);
    expect(res.status).toBe(400);
    const invalidBody = await refusal(res);
    expect(invalidBody).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { chat: 'voice_invalid' },
    });
    const retired = await readyVoiceAsset(a.token, 'voice-2s.webm');
    await adminSql`
      update public.media_assets set status = 'deleted', deleted_at = now() where id = ${retired}::uuid`;
    res = await sendDirectVoice(a, b.membershipId, retired);
    expect(res.status).toBe(400);
    expect(await refusal(res)).toEqual(invalidBody);
    res = await sendDirectVoice(a, b.membershipId, randomUUID());
    expect(res.status).toBe(400);
    expect(await refusal(res)).toEqual(invalidBody);

    // An extra key (a duration, an author side) is the plain VALIDATION_FAILED and nothing is written.
    const take = await readyVoiceAsset(a.token, 'voice-2s.webm');
    for (const extra of [{ durationSeconds: 1 }, { side: 'staff' }, { body: 'Oi' }]) {
      res = await post('/v1/chat/direct/voice-messages', a.token, {
        toMembershipId: b.membershipId,
        mediaId: take,
        ...extra,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect(await messageCountOf(take)).toBe(0);

    // An unknown or own membership id is the bare 404 of text, the same body.
    const textMiss = await sendDirect(a, randomUUID(), 'Oi');
    res = await sendDirectVoice(a, randomUUID(), take);
    expect(res.status).toBe(404);
    expect(await refusal(res)).toEqual(await refusal(textMiss));
    res = await sendDirectVoice(a, a.membershipId, take);
    expect(res.status).toBe(404);
    expect(await messageCountOf(take)).toBe(0);

    // A closed pair (A blocked B) is `direct_closed` exactly as text is, the take stays unused; either side.
    expect((await blockUser(a.token, b.userId)).status).toBeLessThan(300);
    const textClosed = await sendDirect(a, b.membershipId, 'Oi');
    expect(textClosed.status).toBe(409);
    const textBody = await refusal(textClosed);
    expect(textBody).toMatchObject({ code: 'CONFLICT', details: { chat: 'direct_closed' } });
    res = await sendDirectVoice(a, b.membershipId, take);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toEqual(textBody);
    const takeB = await readyVoiceAsset(b.token, 'voice-2s.webm');
    res = await sendDirectVoice(b, a.membershipId, takeB);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toEqual(textBody);
    expect(await messageCountOf(take)).toBe(0);
    expect(await messageCountOf(takeB)).toBe(0);
    expect(await pairRows(a, b)).toEqual({ conversations: 0, messages: 0 });

    // T-11-27: an unusable asset is refused BEFORE the pair, so a closed pair reveals nothing through the asset words.
    res = await sendDirectVoice(a, b.membershipId, others);
    expect(res.status).toBe(400);
    expect(await refusal(res)).toEqual(invalidBody);
    const stillProcessing = await processingVoiceAsset(a.token, 'voice-2s.webm');
    res = await sendDirectVoice(a, b.membershipId, stillProcessing);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error.details).toEqual({ chat: 'voice_not_ready' });

    // A staff caller never holds `chat.direct`: 403, no module word.
    const { tokens } = await caseKit();
    for (const token of [tokens.demoSupport, tokens.demoAdmin]) {
      res = await post('/v1/chat/direct/voice-messages', token, {
        toMembershipId: b.membershipId,
        mediaId: take,
      });
      expect(res.status).toBe(403);
    }

    // `social` off is the module word, never a 403.
    const restore = await setModule('demo', 'social', false);
    try {
      res = await sendDirectVoice(other, b.membershipId, others);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    } finally {
      await restore();
    }
  });
});
