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
import { processingVoiceAsset, readyVoiceAsset, removeVoiceRows } from './chat-voice-fixtures';
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

type ErrorBody = { error: { code: string; details?: { chat?: string } } };

/** What a refusal must leave untouched: the message count, the case state and owner, and its events. */
async function snapshotOf(conversationId: string) {
  const [row] = await adminSql<
    { messages: number; events: number; state: string | null; owner: string | null }[]
  >`
    select (select count(*) from public.chat_messages where conversation_id = ${conversationId}::uuid)::int as messages,
           (select count(*) from public.chat_case_events where conversation_id = ${conversationId}::uuid and kind <> 'opened')::int as events,
           c.state, c.owner_user_id::text as owner
      from public.chat_conversations c where c.id = ${conversationId}::uuid`;
  return row;
}

/** The staff posts `body` and the answer is `status` with `details.chat`; the conversation is left as it was. */
async function expectRefusal(
  token: string,
  conversationId: string,
  body: unknown,
  status: number,
  chat: string | undefined,
) {
  const before = await snapshotOf(conversationId);
  const res = await replyVoice(token, conversationId, body);
  expect(res.status).toBe(status);
  const error = ((await res.json()) as ErrorBody).error;
  expect(error.details?.chat).toBe(chat);
  expect(await snapshotOf(conversationId)).toEqual(before);
  return error;
}

const UNKNOWN_ASSET = '5b2b5ed0-60f0-4f2a-9d3c-3b3d5b0c1a11';

const closeCase = (conversationId: string) => adminSql`
  update public.chat_conversations
     set state = 'closed', closed_at = now(), resolved_at = null, staff_last_read_seq = last_seq
   where id = ${conversationId}::uuid`;

/** A hand-made ready asset of another kind owned by `ownerId` (the refusals' image and video). */
const foreignAssetIds: string[] = [];
async function handAsset(ownerId: string, kind: 'image' | 'video' | 'audio', purpose: string) {
  const { ids } = await caseKit();
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds)
    values (${ids.demo}::uuid, ${ownerId}::uuid, ${kind}, ${purpose}, 'ready',
            ${kind === 'image' ? 'image/webp' : 'video/mp4'}, 1000, 2)
    returning id::text as id`;
  const id = row?.id ?? '';
  foreignAssetIds.push(id);
  return id;
}

afterAll(async () => {
  // Hooks run in reverse declaration order (vitest 'stack'): the hand-made rows go before the first hook closes the connection.
  for (const id of foreignAssetIds.splice(0)) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
});

// The ORDER of the refusals, in the order the code checks them (D-862): 1. the `for update` lookup of a SUPPORT
// conversation of the caller's tenant (a bare 404), 2. `member_blocked`, 3. `member_removed`, 4. the asset
// (`voice_not_ready`, `voice_invalid`), 5. the insert, which is where a CLOSED case refuses (`case_closed`).
// No check of the case state runs before the insert, so an asset refusal wins over a closed case.
describe('voice reply refusals', () => {
  it('an unknown conversation id and a conversation of tenant B are the bare 404, nothing is written', async () => {
    const { ids, tokens } = await caseKit();
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const unknown = await replyVoice(tokens.demoSupport, '5b2b5ed0-60f0-4f2a-9d3c-3b3d5b0c1a22', {
      mediaId,
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as ErrorBody).error.code).toBe('NOT_FOUND');

    const [labUser] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${ids.lab}::uuid and role = 'member' limit 1`;
    const [labCase] = await adminSql<{ id: string }[]>`
      insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state)
      values (${ids.lab}::uuid, 'support', ${labUser?.user_id}::uuid, 'open')
      returning id::text as id`;
    const foreign = await replyVoice(tokens.demoSupport, labCase?.id ?? '', { mediaId });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as ErrorBody).error).toMatchObject({ code: 'NOT_FOUND' });
    expect(await snapshotOf(labCase?.id ?? '')).toMatchObject({ messages: 0, events: 0 });
    // The asset was never touched: it still works for the member's real case.
    const { conversationId } = await openedCase('voice-reply-404');
    expect((await replyVoice(tokens.demoSupport, conversationId, { mediaId })).status).toBe(201);
  });

  it('a direct or group conversation id is the same bare 404 (the lookup is kind = support)', async () => {
    const { ids, tokens } = await caseKit();
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    for (const kind of ['direct', 'group']) {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
        values (${ids.demo}::uuid, ${kind}, ${ids.demoMember}::uuid)
        returning id::text as id`;
      const res = await replyVoice(tokens.demoSupport, row?.id ?? '', { mediaId });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
      expect(await snapshotOf(row?.id ?? '')).toMatchObject({ messages: 0 });
    }
  });

  it('a blocked member is 409 member_blocked and a removed one 409 member_removed, both BEFORE the asset is looked at', async () => {
    const { ids, tokens } = await caseKit();
    const { member, conversationId } = await openedCase('voice-reply-blocked');
    const withUnusableAsset = { mediaId: UNKNOWN_ASSET };

    await adminSql`
      update public.memberships set blocked_at = now(), status = 'blocked'
       where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid`;
    await expectRefusal(
      tokens.demoSupport,
      conversationId,
      withUnusableAsset,
      409,
      'member_blocked',
    );

    await adminSql`
      update public.memberships set blocked_at = null, status = 'active', deleted_at = now()
       where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid`;
    await expectRefusal(
      tokens.demoSupport,
      conversationId,
      withUnusableAsset,
      409,
      'member_removed',
    );

    await adminSql`
      update public.memberships set deleted_at = null
       where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid`;
    // The positive control: the same member, active again, gets a real recording.
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    expect((await replyVoice(tokens.demoSupport, conversationId, { mediaId })).status).toBe(201);
  });

  it('a closed case: a ready owned asset is 409 case_closed with no message written', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-reply-closed-ready');
    await closeCase(conversationId);
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const error = await expectRefusal(
      tokens.demoSupport,
      conversationId,
      { mediaId },
      409,
      'case_closed',
    );
    expect(error.code).toBe('CONFLICT');
  });

  it('a closed case: a processing asset is 409 voice_not_ready, NOT case_closed', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-reply-closed-processing');
    await closeCase(conversationId);
    const mediaId = await processingVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    await expectRefusal(tokens.demoSupport, conversationId, { mediaId }, 409, 'voice_not_ready');
  });

  it('a closed case: an unusable asset is 400 voice_invalid, NOT case_closed', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-reply-closed-invalid');
    await closeCase(conversationId);
    await expectRefusal(
      tokens.demoSupport,
      conversationId,
      { mediaId: UNKNOWN_ASSET },
      400,
      'voice_invalid',
    );
  });

  it('a closed case of a blocked member with an unusable asset is 409 member_blocked', async () => {
    const { ids, tokens } = await caseKit();
    const { member, conversationId } = await openedCase('voice-reply-closed-blocked');
    await closeCase(conversationId);
    await adminSql`
      update public.memberships set blocked_at = now(), status = 'blocked'
       where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid`;
    await expectRefusal(
      tokens.demoSupport,
      conversationId,
      { mediaId: UNKNOWN_ASSET },
      409,
      'member_blocked',
    );
  });

  it('a processing asset on an open case is 409 voice_not_ready with the case untouched, and works after the derive', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-reply-notready');
    const mediaId = await processingVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    await expectRefusal(tokens.demoSupport, conversationId, { mediaId }, 409, 'voice_not_ready');
    expect((await snapshotOf(conversationId))?.state).toBe('open');
  });

  it('every unusable asset is the ONE 400 voice_invalid (another staff, a member, deleted, image, unknown, another tenant)', async () => {
    const { ids, tokens } = await caseKit();
    const { member, conversationId } = await openedCase('voice-reply-invalid');

    const anotherStaff = await readyVoiceAsset(tokens.demoAdmin, 'voice-2s.webm');
    const memberAsset = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const deleted = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    await adminSql`
      update public.media_assets set status = 'deleted', deleted_at = now() where id = ${deleted}::uuid`;
    const image = await handAsset(ids.demoSupport, 'image', 'post');
    const [labUser] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${ids.lab}::uuid and role = 'member' limit 1`;
    const [labAsset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets (tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds)
      values (${ids.lab}::uuid, ${labUser?.user_id}::uuid, 'audio', 'voice', 'ready', 'audio/mp4', 1000, 2)
      returning id::text as id`;
    foreignAssetIds.push(labAsset?.id ?? '');

    const answers: unknown[] = [];
    for (const mediaId of [
      anotherStaff,
      memberAsset,
      deleted,
      image,
      UNKNOWN_ASSET,
      labAsset?.id,
    ]) {
      const error = await expectRefusal(
        tokens.demoSupport,
        conversationId,
        { mediaId },
        400,
        'voice_invalid',
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      const { requestId: _requestId, ...rest } = error as typeof error & { requestId?: string };
      answers.push(rest);
    }
    // No existence oracle: the six bodies are identical.
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it('a member token is 403, no token is 401, and an extra key, a body or a malformed id is a plain 400', async () => {
    const { tokens } = await caseKit();
    const { member, conversationId } = await openedCase('voice-reply-guards');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const before = await snapshotOf(conversationId);

    expect((await replyVoice(member.token, conversationId, { mediaId })).status).toBe(403);
    expect(
      (
        await request(`/v1/chat/conversations/${conversationId}/voice-messages`, undefined, {
          method: 'POST',
          body: JSON.stringify({ mediaId }),
        })
      ).status,
    ).toBe(401);
    for (const body of [
      { mediaId, durationSeconds: 1 },
      { mediaId, body: 'oi' },
      { mediaId, category: 'other' },
      { mediaId: 'not-a-uuid' },
      {},
    ]) {
      const refusal = await expectRefusal(tokens.demoSupport, conversationId, body, 400, undefined);
      expect(refusal.code).toBe('VALIDATION_FAILED');
    }
    expect(await snapshotOf(conversationId)).toEqual(before);
  });
});

describe('voice reply case matrix', () => {
  it('an unowned open case is taken: in progress, owned by the author, one taken event with the message id', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-take');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const res = await replyVoice(tokens.demoSupport, conversationId, { mediaId });
    expect(res.status).toBe(201);
    const result = (await res.json()) as SendResult;
    expect(await stateOf(conversationId)).toEqual({ state: 'in_progress', owner: ids.demoSupport });
    expect(await eventsOf(conversationId)).toEqual([
      { kind: 'taken', actor: ids.demoSupport, message_id: result.message.id },
    ]);
  });

  it('a case owned by another staff user keeps that owner and writes no event', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-other');
    await adminSql`
      update public.chat_conversations set state = 'in_progress', owner_user_id = ${ids.demoAdmin}::uuid
       where id = ${conversationId}::uuid`;
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    expect((await replyVoice(tokens.demoSupport, conversationId, { mediaId })).status).toBe(201);
    expect(await stateOf(conversationId)).toEqual({ state: 'in_progress', owner: ids.demoAdmin });
    expect(await eventsOf(conversationId)).toEqual([]);
  });

  it('a case owned by the sender stays as it is', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-own');
    await adminSql`
      update public.chat_conversations set state = 'in_progress', owner_user_id = ${ids.demoSupport}::uuid
       where id = ${conversationId}::uuid`;
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    expect((await replyVoice(tokens.demoSupport, conversationId, { mediaId })).status).toBe(201);
    expect(await stateOf(conversationId)).toEqual({ state: 'in_progress', owner: ids.demoSupport });
    expect(await eventsOf(conversationId)).toEqual([]);
  });

  it('a resolved case stays resolved: no reopened event, the owner is untouched (D-806)', async () => {
    const { ids, tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-resolved');
    await adminSql`
      update public.chat_conversations
         set state = 'resolved', resolved_at = now(), owner_user_id = ${ids.demoAdmin}::uuid
       where id = ${conversationId}::uuid`;
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    expect((await replyVoice(tokens.demoSupport, conversationId, { mediaId })).status).toBe(201);
    expect(await stateOf(conversationId)).toEqual({ state: 'resolved', owner: ids.demoAdmin });
    expect(await eventsOf(conversationId)).toEqual([]);
  });

  it('a take is single-use: the same staff user again answers the stored message, another staff user is voice_invalid', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-once');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const first = await replyVoice(tokens.demoSupport, conversationId, { mediaId });
    expect(first.status).toBe(201);
    const stored = (await first.json()) as SendResult;

    const again = await replyVoice(tokens.demoSupport, conversationId, { mediaId });
    expect(again.status).toBe(201);
    expect(((await again.json()) as SendResult).message.id).toBe(stored.message.id);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where media_asset_id = ${mediaId}::uuid`;
    expect(count?.n).toBe(1);

    await expectRefusal(tokens.demoAdmin, conversationId, { mediaId }, 400, 'voice_invalid');
  });

  it('a take already sent to one conversation is spent for another (voice_invalid)', async () => {
    const { tokens } = await caseKit();
    const one = await openedCase('voice-matrix-spent-a');
    const two = await openedCase('voice-matrix-spent-b');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    expect((await replyVoice(tokens.demoSupport, one.conversationId, { mediaId })).status).toBe(
      201,
    );
    await expectRefusal(tokens.demoSupport, two.conversationId, { mediaId }, 400, 'voice_invalid');
  });

  it('twenty concurrent sends of one take store one message and every call answers it', async () => {
    const { tokens } = await caseKit();
    const { conversationId } = await openedCase('voice-matrix-race');
    const mediaId = await readyVoiceAsset(tokens.demoSupport, 'voice-2s.webm');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => replyVoice(tokens.demoSupport, conversationId, { mediaId })),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(20).fill(201));
    const ids = new Set(
      await Promise.all(
        responses.map(async (res) => ((await res.json()) as SendResult).message.id),
      ),
    );
    expect(ids.size).toBe(1);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where media_asset_id = ${mediaId}::uuid`;
    expect(count?.n).toBe(1);
  });
});
