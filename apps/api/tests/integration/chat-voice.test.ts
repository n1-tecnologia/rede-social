import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { SendResult, SupportThread } from '@rede-social/module-chat/contracts';
import postgres from 'postgres';
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
import {
  deriveVoiceAsset,
  processingVoiceAsset,
  readyVoiceAsset,
  removeVoiceRows,
} from './chat-voice-fixtures';
import { adminSql, HOSTS, SEED_PASSWORD, signInAs } from './setup';

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
/** Image and video rows the refusal tests insert by hand (the helpers only make voice takes). */
const foreignAssetIds: string[] = [];

beforeAll(async () => {
  await caseKit();
  await sweepCases();
});

afterAll(async () => {
  await sweepCases();
  await removeVoiceRows(memberIds);
  for (const id of foreignAssetIds.splice(0)) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }
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

/** A fresh member with nothing in the chat tables, registered for the voice cleanup. */
async function voiceMember(label: string) {
  const member = await throwawayMember(label);
  memberIds.push(member.id);
  return member;
}

/** Everything the chat tables hold for one member: a refusal must leave all three at zero. */
async function chatRowsOf(memberId: string) {
  const [row] = await adminSql<{ conversations: number; participants: number; messages: number }[]>`
    select (select count(*) from public.chat_conversations where created_by_user_id = ${memberId}::uuid)::int as conversations,
           (select count(*) from public.chat_participants where user_id = ${memberId}::uuid)::int as participants,
           (select count(*) from public.chat_messages where author_user_id = ${memberId}::uuid)::int as messages`;
  return row;
}

type ErrorBody = { error: { code: string; details?: { chat?: string } } };

/** The member posts `body` to the voice route and the answer is refused with `status` and `details.chat`. */
async function expectRefusal(
  memberId: string,
  token: string,
  body: unknown,
  status: number,
  chat: string | undefined,
) {
  const res = await sendVoice(token, body);
  expect(res.status).toBe(status);
  const error = ((await res.json()) as ErrorBody).error;
  expect(error.details?.chat).toBe(chat);
  expect(await chatRowsOf(memberId)).toEqual({ conversations: 0, participants: 0, messages: 0 });
  return error;
}

/** A hand-made ready asset of another kind (image, video) owned by `ownerId`, for the refusals. */
async function foreignAsset(ownerId: string, kind: 'image' | 'video', purpose: string) {
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

describe('voice send refusals', () => {
  it('a recording still processing is 409 voice_not_ready, creates no case and no participant row, and works after the derive', async () => {
    const member = await voiceMember('voice-notready');
    const mediaId = await processingVoiceAsset(member.token, 'voice-2s.webm');
    await expectRefusal(member.id, member.token, { mediaId }, 409, 'voice_not_ready');

    await deriveVoiceAsset(mediaId);
    const sent = await sendVoice(member.token, { mediaId });
    expect(sent.status).toBe(201);
  });

  it('a random uuid is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-random');
    const refusal = await expectRefusal(
      member.id,
      member.token,
      { mediaId: '5b2b5ed0-60f0-4f2a-9d3c-3b3d5b0c1a11' },
      400,
      'voice_invalid',
    );
    expect(refusal.code).toBe('VALIDATION_FAILED');
  });

  it("another member's ready asset is the same 400 voice_invalid and creates nothing", async () => {
    const owner = await voiceMember('voice-owner');
    const thief = await voiceMember('voice-thief');
    const mediaId = await readyVoiceAsset(owner.token, 'voice-2s.webm');
    await expectRefusal(thief.id, thief.token, { mediaId }, 400, 'voice_invalid');
    // The positive control: the owner can use it.
    expect((await sendVoice(owner.token, { mediaId })).status).toBe(201);
  });

  it("another tenant's asset is the same 400 voice_invalid and creates nothing", async () => {
    const { ids } = await caseKit();
    const member = await voiceMember('voice-tenantb');
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
    try {
      // The lab tenant has `chat` OFF in the seed, and a voice upload asks for a chat permission: turn it on here.
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${ids.lab}::uuid, 'chat', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(ids.lab);
      const labToken = await signInAs('member@rede-lab.local', SEED_PASSWORD);
      const labAsset = await readyVoiceAsset(labToken, 'voice-2s.webm', HOSTS.lab);
      await expectRefusal(member.id, member.token, { mediaId: labAsset }, 400, 'voice_invalid');
    } finally {
      if (labFlag) {
        await adminSql`
          update public.tenant_modules set enabled = ${labFlag.enabled}
           where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${ids.lab}::uuid and module_key = 'chat'`;
      }
      moduleFlags.invalidate(ids.lab);
    }
  });

  it('a soft-deleted asset is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-softdeleted');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    await adminSql`
      update public.media_assets set status = 'deleted', deleted_at = now()
       where id = ${mediaId}::uuid`;
    await expectRefusal(member.id, member.token, { mediaId }, 400, 'voice_invalid');
  });

  it('a rejected asset is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-rejected');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    await adminSql`
      update public.media_assets set status = 'rejected', failure_reason = 'transcode_failed'
       where id = ${mediaId}::uuid`;
    await expectRefusal(member.id, member.token, { mediaId }, 400, 'voice_invalid');
  });

  it('a failed asset is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-failed');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    await adminSql`
      update public.media_assets set status = 'failed' where id = ${mediaId}::uuid`;
    await expectRefusal(member.id, member.token, { mediaId }, 400, 'voice_invalid');
  });

  it('an image asset is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-image');
    const mediaId = await foreignAsset(member.id, 'image', 'post');
    await expectRefusal(member.id, member.token, { mediaId }, 400, 'voice_invalid');
  });

  it('a video asset is 400 voice_invalid and creates nothing', async () => {
    const member = await voiceMember('voice-video');
    const mediaId = await foreignAsset(member.id, 'video', 'post');
    await expectRefusal(member.id, member.token, { mediaId }, 400, 'voice_invalid');
  });

  it('every unusable asset answers the SAME status and body (no existence oracle)', async () => {
    const member = await voiceMember('voice-oracle');
    const other = await voiceMember('voice-oracle-other');
    const foreign = await readyVoiceAsset(other.token, 'voice-2s.webm');
    const unknown = await sendVoice(member.token, {
      mediaId: '6c3c6fe1-71a1-4a3b-8e4d-4c4e6c1d2b22',
    });
    const owned = await sendVoice(member.token, { mediaId: foreign });
    expect(owned.status).toBe(unknown.status);
    const withoutRequestId = async (res: Response) => {
      const body = (await res.json()) as ErrorBody & { error: { requestId?: string } };
      const { requestId: _requestId, ...rest } = body.error;
      return rest;
    };
    expect(await withoutRequestId(owned)).toEqual(await withoutRequestId(unknown));
  });

  it('an extra key (durationSeconds, priority, body) is a plain 400 VALIDATION_FAILED and creates nothing', async () => {
    const member = await voiceMember('voice-extra');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    for (const extra of [{ durationSeconds: 1 }, { priority: 'high' }, { body: 'oi' }]) {
      const refusal = await expectRefusal(
        member.id,
        member.token,
        { mediaId, ...extra },
        400,
        undefined,
      );
      expect(refusal.code).toBe('VALIDATION_FAILED');
    }
  });

  it('a mediaId that is not a uuid, or missing, is 400 VALIDATION_FAILED', async () => {
    const member = await voiceMember('voice-badid');
    for (const body of [{ mediaId: 'not-a-uuid' }, { mediaId: 7 }, {}]) {
      const refusal = await expectRefusal(member.id, member.token, body, 400, undefined);
      expect(refusal.code).toBe('VALIDATION_FAILED');
    }
  });

  it('a staff token on the member route is 403, and no token is 401', async () => {
    const { tokens } = await caseKit();
    const member = await voiceMember('voice-staffroute');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    for (const token of [tokens.demoSupport, tokens.demoAdmin]) {
      expect((await sendVoice(token, { mediaId })).status).toBe(403);
    }
    expect(
      (
        await request('/v1/chat/support/voice-messages', undefined, {
          method: 'POST',
          body: JSON.stringify({ mediaId }),
        })
      ).status,
    ).toBe(401);
    expect(await chatRowsOf(member.id)).toEqual({ conversations: 0, participants: 0, messages: 0 });
  });
});

describe('voice send case flow', () => {
  const caseRow = (conversationId: string) =>
    adminSql<{ category: string; subject: string | null; state: string; case_number: number }[]>`
      select category, subject, state, case_number
        from public.chat_conversations where id = ${conversationId}::uuid`;

  it('a first recording with a category and a subject opens the case with both (VOICE-31, D-861)', async () => {
    const member = await voiceMember('voice-opener');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const sent = await sendVoice(member.token, { mediaId, category: 'payment', subject: 'Pix' });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    expect(result.case?.opened).toBe(true);
    const [row] = await caseRow(result.conversationId);
    expect(row?.category).toBe('payment');
    expect(row?.subject).toBe('Pix');
    expect(row?.state).toBe('open');
  });

  it('a first recording with no subject leaves the stored subject null and the category other', async () => {
    const member = await voiceMember('voice-nosubject');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const sent = await sendVoice(member.token, { mediaId, subject: '   ' });
    expect(sent.status).toBe(201);
    const result = (await sent.json()) as SendResult;
    const [row] = await caseRow(result.conversationId);
    expect(row?.subject).toBeNull();
    expect(row?.category).toBe('other');
  });

  it('a second recording goes to the active case, gets the next seq and ignores a category and subject (D-812)', async () => {
    const member = await voiceMember('voice-second');
    const first = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const second = await readyVoiceAsset(member.token, 'voice-2s.mp4');
    const one = (await (await sendVoice(member.token, { mediaId: first })).json()) as SendResult;
    const sent = await sendVoice(member.token, {
      mediaId: second,
      category: 'events',
      subject: 'Outro',
    });
    expect(sent.status).toBe(201);
    const two = (await sent.json()) as SendResult;
    expect(two.conversationId).toBe(one.conversationId);
    expect(two.message.seq).toBe(2);
    expect(two.case?.opened).toBe(false);
    const [row] = await caseRow(two.conversationId);
    expect(row?.category).toBe('other');
    expect(row?.subject).toBeNull();
  });

  it('a recording to a resolved case reopens it with one reopened event carrying the message id (VOICE-05)', async () => {
    const { ids } = await caseKit();
    const member = await voiceMember('voice-reopen');
    const first = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const second = await readyVoiceAsset(member.token, 'voice-2s.ogg');
    const one = (await (await sendVoice(member.token, { mediaId: first })).json()) as SendResult;
    await adminSql`
      update public.chat_conversations
         set state = 'resolved', resolved_at = now(), owner_user_id = ${ids.demoSupport}::uuid
       where id = ${one.conversationId}::uuid`;

    const sent = await sendVoice(member.token, { mediaId: second });
    expect(sent.status).toBe(201);
    const two = (await sent.json()) as SendResult;
    expect(two.conversationId).toBe(one.conversationId);
    expect(two.case?.reopened).toBe(true);
    expect(two.case?.opened).toBe(false);
    expect(two.case?.state).toBe('open');
    const events = await adminSql<{ kind: string; message_id: string | null }[]>`
      select kind, message_id::text as message_id from public.chat_case_events
       where conversation_id = ${one.conversationId}::uuid and kind = 'reopened'`;
    expect(events).toEqual([{ kind: 'reopened', message_id: two.message.id }]);
  });

  it('a recording after the case is closed opens a NEW case numbered one higher', async () => {
    const member = await voiceMember('voice-renew');
    const first = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const second = await readyVoiceAsset(member.token, 'voice-2s.mp4');
    const one = (await (await sendVoice(member.token, { mediaId: first })).json()) as SendResult;
    await adminSql`
      update public.chat_conversations
         set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
       where id = ${one.conversationId}::uuid`;

    const sent = await sendVoice(member.token, { mediaId: second });
    expect(sent.status).toBe(201);
    const two = (await sent.json()) as SendResult;
    expect(two.conversationId).not.toBe(one.conversationId);
    expect(two.case?.opened).toBe(true);
    expect(two.case?.number).toBe((one.case?.number ?? 0) + 1);
    expect(two.message.seq).toBe(1);
  });

  it('a case closed between the validation and the insert lands in a NEW case, never the closed one', async () => {
    const member = await voiceMember('voice-race');
    const first = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const second = await readyVoiceAsset(member.token, 'voice-2s.mp4');
    const one = (await (await sendVoice(member.token, { mediaId: first })).json()) as SendResult;

    // A SECOND connection plays the staff close: it takes the conversation row lock and holds it.
    const closer = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
      prepare: false,
      max: 1,
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const closing = closer.begin(async (tx) => {
      await tx`
        update public.chat_conversations
           set state = 'closed', closed_at = now(), staff_last_read_seq = last_seq
         where id = ${one.conversationId}::uuid`;
      locked();
      await held;
    });
    try {
      await lockTaken;
      const racing = sendVoice(member.token, { mediaId: second });
      // No sleep: poll the lock table until the member's insert is queued behind the close.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const [waiting] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`;
        if ((waiting?.n ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      await closing;
      const answer = await racing;
      expect(answer.status).toBe(201);
      const two = (await answer.json()) as SendResult;
      expect(two.conversationId).not.toBe(one.conversationId);
      expect(two.message.seq).toBe(1);
      expect(two.case?.opened).toBe(true);
      const states = await adminSql<{ id: string; state: string }[]>`
        select id::text as id, state from public.chat_conversations
         where created_by_user_id = ${member.id}::uuid order by case_number`;
      expect(states.map((row) => [row.id, row.state])).toEqual([
        [one.conversationId, 'closed'],
        [two.conversationId, 'open'],
      ]);
    } finally {
      release();
      await closing.catch(() => undefined);
      await closer.end();
    }
  });

  it('a blocked member and a removed member are refused as text is, with the same status and code, before any insert', async () => {
    const { ids } = await caseKit();
    const member = await voiceMember('voice-state');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const refusalOf = async (res: Response) => ({ status: res.status, body: await res.json() });
    const states: [string, string][] = [
      [`blocked_at = now(), status = 'blocked'`, 'blocked'],
      [`blocked_at = null, status = 'active', deleted_at = now()`, 'removed'],
    ];
    try {
      for (const [change] of states) {
        await adminSql.unsafe(
          `update public.memberships set ${change}
            where tenant_id = '${ids.demo}'::uuid and user_id = '${member.id}'::uuid`,
        );
        const text = await refusalOf(
          await post('/v1/chat/support/messages', member.token, { body: 'Oi' }),
        );
        const voice = await refusalOf(await sendVoice(member.token, { mediaId }));
        expect(text.status).toBeGreaterThanOrEqual(400);
        expect(voice.status).toBe(text.status);
        expect((voice.body as ErrorBody).error.code).toBe((text.body as ErrorBody).error.code);
        expect(await chatRowsOf(member.id)).toEqual({
          conversations: 0,
          participants: 0,
          messages: 0,
        });
      }
    } finally {
      await adminSql`
        update public.memberships
           set blocked_at = null, status = 'active', deleted_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${member.id}::uuid`;
    }
  });
});

describe('voice send concurrency', () => {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);

  it('twenty simultaneous posts of ONE take store exactly one message and all answer 201 with its id (VOICE-18)', async () => {
    const member = await voiceMember('voice-twenty');
    const mediaId = await readyVoiceAsset(member.token, 'voice-2s.webm');

    const results = await Promise.all(range(1, 20).map(() => sendVoice(member.token, { mediaId })));
    expect(results.map((res) => res.status)).toEqual(Array(20).fill(201));
    const bodies = (await Promise.all(results.map((res) => res.json()))) as SendResult[];
    expect(new Set(bodies.map((body) => body.message.id)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.conversationId)).size).toBe(1);
    expect(bodies.filter((body) => body.case?.opened).length).toBeLessThanOrEqual(1);

    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where media_asset_id = ${mediaId}::uuid`;
    expect(count?.n).toBe(1);
    const [cases] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_conversations
       where created_by_user_id = ${member.id}::uuid`;
    expect(cases?.n).toBe(1);
  });

  it('two different takes sent together get seq values that differ by one, with no gap', async () => {
    const member = await voiceMember('voice-pair');
    const a = await readyVoiceAsset(member.token, 'voice-2s.webm');
    const b = await readyVoiceAsset(member.token, 'voice-2s.mp4');

    const [one, two] = await Promise.all([
      sendVoice(member.token, { mediaId: a }),
      sendVoice(member.token, { mediaId: b }),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const seqs = [
      ((await one.json()) as SendResult).message.seq,
      ((await two.json()) as SendResult).message.seq,
    ].sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2]);
  });
});
