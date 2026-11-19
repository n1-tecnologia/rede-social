import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseKit, removeThrowaways, request } from './chat-case-fixtures';
import {
  blockUser,
  directCountOf,
  directMember,
  directRowsOf,
  directWith,
  removeDirectRows,
  resetDirectLimiters,
  sendDirect,
  setModule,
  unblockUser,
  withDirectModules,
} from './direct-fixtures';
import { adminSql, uploadAvatar } from './setup';

/**
 * Phase 11 plan 08 (CHAT-06; D-719, D-720, D-721, D-722; T-11-01, T-11-03, T-11-06): the direct conversation through the
 * API, end to end against the live local stack.
 *
 * `direct tracer` (this plan's first slice): member A writes to member B, the conversation is created lazily in the
 * SAME transaction as the first message, there is at most one per pair, twenty concurrent first sends make one, every
 * miss is one bare 404, and a closed pair is refused with the one word `direct_closed` that never says why.
 *
 * FIXTURES. Members are throwaways of the demo tenant (each WITH a display name); the seed has `chat` and no `social`
 * there, so the suite turns `social` and `chat` on for its span and puts them back. Rows are swept before the users.
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order). The limiters are per process and are reset
 * before every case that sends more than a few messages.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

let restoreModules: () => Promise<void> = async () => {};

beforeAll(async () => {
  await caseKit();
  restoreModules = await withDirectModules('demo');
  resetDirectLimiters();
});

afterAll(async () => {
  await removeDirectRows(['dctr']);
  await removeThrowaways();
  await restoreModules();
  resetDirectLimiters();
});

/** The answer with the one field that identifies the CALL (`requestId`) taken out, so two refusals compare. */
async function sansRequestId(res: Response): Promise<string> {
  const text = await res.text();
  const parsed = JSON.parse(text) as { error: Record<string, unknown> };
  const { requestId: _requestId, ...error } = parsed.error;
  return JSON.stringify({ error });
}

async function expectBareNotFound(res: Response, label: string): Promise<string> {
  const text = await res.text();
  expect(res.status, `${label}: ${text}`).toBe(404);
  const body = JSON.parse(text) as Envelope;
  expect(body.error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(body.error, 'details'), label).toBe(false);
  const { requestId: _requestId, ...error } = body.error as Record<string, unknown>;
  return JSON.stringify({ error });
}

type SendBody = {
  conversationId: string;
  created: boolean;
  message: { id: string; seq: number; side: string; body: string; authorIsViewer: boolean };
};

describe('direct tracer', () => {
  it('1. the path: A writes to B, one conversation is born with its first message, B answers into the SAME one', async () => {
    const a = await directMember('t1a');
    const b = await directMember('t1b');

    const first = await sendDirect(a, b.membershipId, '  Oi  ');
    expect(first.status).toBe(201);
    const sent = (await first.json()) as SendBody;
    expect(Object.keys(sent).sort()).toEqual(['conversationId', 'created', 'message']);
    expect(sent.created).toBe(true);
    expect(sent.message).toMatchObject({
      seq: 1,
      side: 'member',
      body: 'Oi',
      authorIsViewer: true,
    });

    const rows = await directRowsOf(a.userId, b.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: sent.conversationId,
      created_by_user_id: a.userId,
      messages: 1,
      participants: 2,
    });
    const [pair] = await adminSql<{ low: string; high: string; kind: string; ordered: boolean }[]>`
      select direct_low_user_id::text as low, direct_high_user_id::text as high, kind,
             direct_low_user_id < direct_high_user_id as ordered
        from public.chat_conversations where id = ${sent.conversationId}::uuid`;
    expect(pair?.kind).toBe('direct');
    expect(pair?.ordered).toBe(true);
    expect([pair?.low, pair?.high].sort()).toEqual([a.userId, b.userId].sort());

    const back = await sendDirect(b, a.membershipId, 'Oi, tudo bem?');
    expect(back.status).toBe(201);
    const answered = (await back.json()) as SendBody;
    expect(answered.conversationId).toBe(sent.conversationId);
    expect(answered.created).toBe(false);
    expect(answered.message).toMatchObject({ seq: 2, side: 'member', authorIsViewer: true });
    const after = await directRowsOf(a.userId, b.userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ messages: 2, participants: 2 });

    // A second message from A: still one conversation, the third seq.
    const again = (await (await sendDirect(a, b.membershipId, 'Combinado')).json()) as SendBody;
    expect(again.conversationId).toBe(sent.conversationId);
    expect(again.message.seq).toBe(3);
  });

  it('2. twenty concurrent first sends from A to a new member C leave exactly one conversation and twenty messages numbered 1..20', async () => {
    resetDirectLimiters();
    const a = await directMember('t2a');
    const c = await directMember('t2c');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => sendDirect(a, c.membershipId, `mensagem ${index}`)),
    );
    expect(results.map((res) => res.status)).toEqual(Array(20).fill(201));
    const bodies = (await Promise.all(results.map((res) => res.json()))) as SendBody[];
    expect(new Set(bodies.map((body) => body.conversationId)).size).toBe(1);
    expect(bodies.filter((body) => body.created)).toHaveLength(1);
    expect(bodies.map((body) => body.message.seq).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    const rows = await directRowsOf(a.userId, c.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ messages: 20, participants: 2 });
    resetDirectLimiters();
  });

  it('3. refusals: every miss is one bare 404 with an identical body; the guards, the strict body and the encoding rules', async () => {
    resetDirectLimiters();
    const { ids } = await caseKit();
    const a = await directMember('t3a');
    const staffTarget = await directMember('t3s', { role: 'support_tenant' });
    const staffCaller = await directMember('t3c', { role: 'support_tenant' });
    const target = await directMember('t3b');
    const [labMembership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.lab}::uuid and role = 'member' limit 1`;
    expect(labMembership?.id).toBeTruthy();

    // One bare 404, byte for byte the same for a staff target, oneself, another tenant's membership and an unknown id.
    const misses = {
      staff: await expectBareNotFound(await sendDirect(a, staffTarget.membershipId, 'Oi'), 'staff'),
      self: await expectBareNotFound(await sendDirect(a, a.membershipId, 'Oi'), 'self'),
      otherTenant: await expectBareNotFound(
        await sendDirect(a, labMembership?.id ?? '', 'Oi'),
        'other tenant',
      ),
      unknown: await expectBareNotFound(await sendDirect(a, randomUUID(), 'Oi'), 'unknown'),
    };
    expect(new Set(Object.values(misses)).size).toBe(1);
    expect(await directCountOf(a.userId)).toBe(0);

    // `social` off is the module refusal, never the permission one (D-719).
    const restoreSocial = await setModule('demo', 'social', false);
    try {
      const off = await sendDirect(a, target.membershipId, 'Oi');
      expect(off.status).toBe(404);
      expect(((await off.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    } finally {
      await restoreSocial();
    }
    // `chat` off as well.
    const restoreChat = await setModule('demo', 'chat', false);
    try {
      const off = await sendDirect(a, target.membershipId, 'Oi');
      expect(off.status).toBe(404);
      expect(((await off.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
    } finally {
      await restoreChat();
    }

    // A staff caller never holds `chat.direct`: 403 FORBIDDEN, not a 404 and not a refusal of the pair.
    const staff = await sendDirect(staffCaller, target.membershipId, 'Oi');
    expect(staff.status).toBe(403);
    expect(((await staff.json()) as Envelope).error.code).toBe('FORBIDDEN');

    // No session: 401.
    const anonymous = await request('/v1/chat/direct/messages', undefined, {
      method: 'POST',
      body: JSON.stringify({ toMembershipId: target.membershipId, body: 'Oi' }),
    });
    expect(anonymous.status).toBe(401);

    // The body is strict: nothing but `toMembershipId` and `body` (a user id, a conversation id, a tenant id, a side).
    for (const extra of [
      { userId: target.userId },
      { conversationId: randomUUID() },
      { tenantId: ids.demo },
      { side: 'staff' },
    ]) {
      const res = await request('/v1/chat/direct/messages', a.token, {
        method: 'POST',
        body: JSON.stringify({ toMembershipId: target.membershipId, body: 'Oi', ...extra }),
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect(await directCountOf(a.userId)).toBe(0);

    // CHAT-06 edge encoding: whitespace is `body_required`, 2001 code points `body_too_long`.
    const blank = await sendDirect(a, target.membershipId, ' \n\t ');
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as Envelope).error.details?.chat).toBe('body_required');
    const tooLong = await sendDirect(a, target.membershipId, '😀'.repeat(2001));
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as Envelope).error.details?.chat).toBe('body_too_long');
    expect(await directCountOf(a.userId)).toBe(0);

    // Accepted: 2000 emoji, 2000 combining pairs (4000 UTF-16 units), and the inner line breaks kept as sent.
    for (const body of ['😀'.repeat(2000), 'é'.repeat(1000)]) {
      const ok = await sendDirect(a, target.membershipId, body);
      expect(ok.status).toBe(201);
      expect(((await ok.json()) as SendBody).message.body).toBe(body);
    }
    const multiline = await sendDirect(a, target.membershipId, '  linha 1\n\nlinha 3  \n');
    expect(multiline.status).toBe(201);
    expect(((await multiline.json()) as SendBody).message.body).toBe('linha 1\n\nlinha 3');
    const [stored] = await adminSql<{ body: string }[]>`
      select body from public.chat_messages
       where author_user_id = ${a.userId}::uuid order by seq desc limit 1`;
    expect(stored?.body).toBe('linha 1\n\nlinha 3');
    resetDirectLimiters();
  });

  it('4. the neutral refusal: after a block either side gets 409 `direct_closed`, nothing is written and no word names the block', async () => {
    resetDirectLimiters();
    const blocker = await directMember('t4a', { displayName: 'Beatriz Bloqueadora' });
    const blocked = await directMember('t4b', { displayName: 'Bruno Bloqueado' });

    // A pair that already talks.
    expect((await sendDirect(blocker, blocked.membershipId, 'Oi')).status).toBe(201);
    const before = await directRowsOf(blocker.userId, blocked.userId);
    expect(before).toHaveLength(1);
    expect(before[0]?.messages).toBe(1);

    expect((await blockUser(blocker.token, blocked.userId)).status).toBe(200);

    const fromBlocked = await sendDirect(blocked, blocker.membershipId, 'Por que?');
    const fromBlocker = await sendDirect(blocker, blocked.membershipId, 'Oi de novo');
    expect(fromBlocked.status).toBe(409);
    expect(fromBlocker.status).toBe(409);
    const blockedText = await fromBlocked.clone().text();
    const blockerText = await fromBlocker.clone().text();
    for (const text of [blockedText, blockerText]) {
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details).toEqual({ chat: 'direct_closed' });
      // Never a block word, the staff-side word, a name or an id.
      for (const needle of [
        'member_blocked',
        'member_removed',
        'block',
        'bloque',
        'Beatriz',
        'Bruno',
        blocker.userId,
        blocked.userId,
        blocker.membershipId,
        blocked.membershipId,
      ]) {
        expect(text.toLowerCase(), needle).not.toContain(needle.toLowerCase());
      }
    }
    // The two sides read the same refusal.
    expect(await sansRequestId(fromBlocked)).toBe(await sansRequestId(fromBlocker));

    // Nothing was written: the same conversation, the same one message.
    const after = await directRowsOf(blocker.userId, blocked.userId);
    expect(after).toHaveLength(1);
    expect(after[0]?.messages).toBe(1);

    // A pair that never talked: the refusal also leaves no conversation behind (one transaction).
    const stranger = await directMember('t4c');
    const other = await directMember('t4d');
    expect((await blockUser(stranger.token, other.userId)).status).toBe(200);
    const closed = await sendDirect(other, stranger.membershipId, 'Oi');
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as Envelope).error.details).toEqual({ chat: 'direct_closed' });
    expect(await directRowsOf(stranger.userId, other.userId)).toHaveLength(0);
    expect(await directCountOf(other.userId)).toBe(0);
  });
});

type WithAnswer = {
  conversationId: string | null;
  other: {
    membershipId: string;
    displayName: string | null;
    avatarAssetId: string | null;
    removed: boolean;
  };
  composer: string;
};

describe('direct with', () => {
  it('5. a pair with no conversation answers null, the other member and `open`; after the first message both see the same id', async () => {
    const a = await directMember('w1a', { displayName: 'Ana Aberta' });
    const b = await directMember('w1b', { displayName: 'Bia Aberta' });

    const empty = await directWith(a, b.membershipId);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    const none = (await empty.json()) as WithAnswer;
    expect(Object.keys(none).sort()).toEqual(['composer', 'conversationId', 'other']);
    expect(Object.keys(none.other).sort()).toEqual([
      'avatarAssetId',
      'displayName',
      'membershipId',
      'removed',
    ]);
    expect(none).toEqual({
      conversationId: null,
      other: {
        membershipId: b.membershipId,
        displayName: 'Bia Aberta',
        avatarAssetId: null,
        removed: false,
      },
      composer: 'open',
    });
    // A GET writes nothing.
    expect(await directRowsOf(a.userId, b.userId)).toHaveLength(0);

    const sent = (await (await sendDirect(a, b.membershipId, 'Oi')).json()) as SendBody;
    const fromA = (await (await directWith(a, b.membershipId)).json()) as WithAnswer;
    const fromB = (await (await directWith(b, a.membershipId)).json()) as WithAnswer;
    expect(fromA.conversationId).toBe(sent.conversationId);
    expect(fromB.conversationId).toBe(sent.conversationId);
    expect(fromA.composer).toBe('open');
    expect(fromB.composer).toBe('open');
    expect(fromA.other.displayName).toBe('Bia Aberta');
    expect(fromB.other).toEqual({
      membershipId: a.membershipId,
      displayName: 'Ana Aberta',
      avatarAssetId: null,
      removed: false,
    });
  });

  it('6. the avatar id appears only while the profile asset is live', async () => {
    const a = await directMember('w2a');
    const b = await directMember('w2b');
    const assetId = await uploadAvatar(b.token);
    try {
      await adminSql`
        update public.member_profiles set avatar_asset_id = ${assetId}::uuid
         where membership_id = ${b.membershipId}::uuid`;
      const live = (await (await directWith(a, b.membershipId)).json()) as WithAnswer;
      expect(live.other.avatarAssetId).toBe(assetId);
      await adminSql`update public.media_assets set deleted_at = now() where id = ${assetId}::uuid`;
      const gone = (await (await directWith(a, b.membershipId)).json()) as WithAnswer;
      expect(gone.other.avatarAssetId).toBeNull();
      expect(gone.other.displayName).toBe(b.displayName);
    } finally {
      await adminSql`
        update public.member_profiles set avatar_asset_id = null
         where membership_id = ${b.membershipId}::uuid`;
      await adminSql`delete from public.media_assets where id = ${assetId}::uuid`;
    }
  });

  it('7. a blocked pair is NOT a miss: 200, `closed` for the blocked side and `blocker` for the blocker, differing in nothing else', async () => {
    const blocker = await directMember('w3a');
    const blocked = await directMember('w3b');
    await sendDirect(blocker, blocked.membershipId, 'Oi');
    expect((await blockUser(blocker.token, blocked.userId)).status).toBe(200);

    const asBlocker = await directWith(blocker, blocked.membershipId);
    const asBlocked = await directWith(blocked, blocker.membershipId);
    expect(asBlocker.status).toBe(200);
    expect(asBlocked.status).toBe(200);
    const seenByBlocker = (await asBlocker.json()) as WithAnswer;
    const seenByBlocked = (await asBlocked.json()) as WithAnswer;
    expect(seenByBlocker.composer).toBe('blocker');
    expect(seenByBlocked.composer).toBe('closed');
    // The two answers have the same shape; only the composer word is told apart (the existing history is shown to both).
    expect(Object.keys(seenByBlocker).sort()).toEqual(Object.keys(seenByBlocked).sort());
    expect(Object.keys(seenByBlocker.other).sort()).toEqual(
      Object.keys(seenByBlocked.other).sort(),
    );
    expect(seenByBlocker.conversationId).toBe(seenByBlocked.conversationId);
    expect(seenByBlocker.conversationId).not.toBeNull();
    expect(seenByBlocker.other.removed).toBe(seenByBlocked.other.removed);
    expect(JSON.stringify(seenByBlocker)).not.toMatch(/block(ed|er)?:|blockedMe|blockedBy/i);

    // Unblocking reopens the composer for both.
    expect((await unblockUser(blocker.token, blocked.userId)).status).toBe(200);
    for (const [viewer, other] of [
      [blocker, blocked],
      [blocked, blocker],
    ] as const) {
      const again = (await (await directWith(viewer, other.membershipId)).json()) as WithAnswer;
      expect(again.composer).toBe('open');
    }

    // A pair that never talked: a block still answers 200 with the strip word, never a 404.
    const p = await directMember('w3c');
    const q = await directMember('w3d');
    await blockUser(p.token, q.userId);
    const fresh = (await (await directWith(q, p.membershipId)).json()) as WithAnswer;
    expect(fresh).toMatchObject({ conversationId: null, composer: 'closed' });
    expect(((await (await directWith(p, q.membershipId)).json()) as WithAnswer).composer).toBe(
      'blocker',
    );
  });

  it('8. every miss is the one bare 404: staff, oneself, another tenant, an administrator-blocked or removed member, an unknown id', async () => {
    const { ids } = await caseKit();
    const a = await directMember('w4a');
    const staff = await directMember('w4s', { role: 'support_tenant' });
    const adminBlocked = await directMember('w4b');
    const removed = await directMember('w4r');
    const [labMembership] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where tenant_id = ${ids.lab}::uuid and role = 'member' limit 1`;
    // A conversation with each of the two members exists BEFORE they are taken out (the read must still be a miss).
    await sendDirect(a, adminBlocked.membershipId, 'Oi');
    await sendDirect(a, removed.membershipId, 'Oi');
    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where id = ${adminBlocked.membershipId}::uuid`;
    await adminSql`
      update public.memberships set deleted_at = now() where id = ${removed.membershipId}::uuid`;

    const misses = {
      staff: await expectBareNotFound(await directWith(a, staff.membershipId), 'staff'),
      self: await expectBareNotFound(await directWith(a, a.membershipId), 'self'),
      otherTenant: await expectBareNotFound(
        await directWith(a, labMembership?.id ?? ''),
        'other tenant',
      ),
      adminBlocked: await expectBareNotFound(
        await directWith(a, adminBlocked.membershipId),
        'administrator-blocked',
      ),
      removed: await expectBareNotFound(await directWith(a, removed.membershipId), 'removed'),
      unknown: await expectBareNotFound(await directWith(a, randomUUID()), 'unknown'),
    };
    expect(new Set(Object.values(misses)).size).toBe(1);
  });

  it('9. the guards: social or chat off is MODULE_DISABLED, a staff caller is 403, no session is 401, a malformed id is 400', async () => {
    const a = await directMember('w5a');
    const b = await directMember('w5b');
    const staffCaller = await directMember('w5c', { role: 'support_tenant' });
    for (const key of ['social', 'chat'] as const) {
      const restore = await setModule('demo', key, false);
      try {
        const off = await directWith(a, b.membershipId);
        expect(off.status, key).toBe(404);
        expect(((await off.json()) as Envelope).error.code, key).toBe('MODULE_DISABLED');
      } finally {
        await restore();
      }
    }
    const staff = await directWith(staffCaller, b.membershipId);
    expect(staff.status).toBe(403);
    expect(((await staff.json()) as Envelope).error.code).toBe('FORBIDDEN');
    expect((await request(`/v1/chat/direct/with/${b.membershipId}`)).status).toBe(401);
    const bad = await directWith(a, 'not-a-uuid');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
  });
});
