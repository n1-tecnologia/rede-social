import type { Tx } from '@rede-social/core/db/tenant-tx';
import { describe, expect, it } from 'vitest';
import { CHAT_NOTIFICATION_KINDS } from '../contracts/index';
import {
  CHAT_PUSH_BODY_MAX,
  memberMessagePushCopy,
  supportReplyPushCopy,
} from '../server/notification-copy';
import {
  CHAT_PUSH_TTL_SECONDS,
  chatNotificationSources,
  conversationTag,
} from '../server/notifications';

/**
 * The chat's `chat.message_sent` source (07-08, D-228, D-235), pinned with a fake `tx` that answers
 * each statement in order: the two push-only intents, their 32-hex tag/topic, the preview cut, and
 * `[]` for a non-support conversation. The SQL is proved end to end by `chat.test.ts`.
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const C = '1d000000-0000-4000-8000-000000000001';
const M = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';

type MessageRow = {
  kind: string;
  member_user_id: string | null;
  member_name: string | null;
  body: string;
  author_side: 'member' | 'staff';
  author_user_id: string;
};

function fakeTx(...answers: unknown[][]): Tx & { calls: number } {
  const queue = [...answers];
  const tx = {
    calls: 0,
    execute: async () => {
      tx.calls += 1;
      return queue.shift() ?? [];
    },
  };
  return tx as unknown as Tx & { calls: number };
}

const source = chatNotificationSources[0];
if (!source) throw new Error('chat declares no chat.message_sent source');

const payload = (authorSide: 'member' | 'staff', authorUserId: string) => ({
  tenantId: T,
  conversationId: C,
  messageId: M,
  seq: 2,
  authorUserId,
  authorSide,
});

const row = (over: Partial<MessageRow>): MessageRow => ({
  kind: 'support',
  member_user_id: MEMBER,
  member_name: 'Membro Rede Demo',
  body: 'Oi! Como posso ajudar?',
  author_side: 'staff',
  author_user_id: STAFF,
  ...over,
});

const meta = { sinkAt: '2026-09-30T12:00:00.000000Z' };

describe('chat notification source', () => {
  it('listens to chat.message_sent only', () => {
    expect(chatNotificationSources.map((s) => s.event)).toEqual(['chat.message_sent']);
  });

  it('the tag and topic are the conversation id without hyphens: exactly 32 hex characters', () => {
    expect(conversationTag(C)).toBe('1d000000000040008000000000000001');
    expect(conversationTag(C)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a STAFF message is ONE push-only intent to the member, titled for the team', async () => {
    const tx = fakeTx([row({})]);
    const intents = await source.resolve(tx, payload('staff', STAFF), meta);
    expect(tx.calls).toBe(1);
    expect(intents).toEqual([
      {
        kind: CHAT_NOTIFICATION_KINDS.supportReply,
        audience: { type: 'users', userIds: [MEMBER] },
        excludeUserIds: [STAFF],
        dedupeKey: `chat.support_reply:${M}`,
        subject: { type: 'conversation', id: C },
        object: null,
        actorUserId: STAFF,
        facts: {},
        channels: ['push'],
        push: {
          title: 'team',
          body: 'Oi! Como posso ajudar?',
          url: '/suporte',
          tag: '1d000000000040008000000000000001',
          topic: '1d000000000040008000000000000001',
          ttlSeconds: CHAT_PUSH_TTL_SECONDS,
          urgency: 'high',
          renotify: true,
        },
      },
    ]);
    expect(CHAT_PUSH_TTL_SECONDS).toBe(259_200);
  });

  it('a MEMBER message is ONE push-only intent to every live staff member but the author', async () => {
    const tx = fakeTx(
      [row({ author_side: 'member', author_user_id: MEMBER, body: 'Quero trocar meu e-mail.' })],
      [{ user_id: ADMIN }, { user_id: STAFF }],
    );
    const intents = await source.resolve(tx, payload('member', MEMBER), meta);
    expect(tx.calls).toBe(2);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: CHAT_NOTIFICATION_KINDS.memberMessage,
      audience: { type: 'users', userIds: [ADMIN, STAFF] },
      excludeUserIds: [MEMBER],
      dedupeKey: `chat.member_message:${M}`,
      subject: { type: 'conversation', id: C },
      facts: {},
      channels: ['push'],
      push: {
        title: 'tenant',
        body: 'Nova mensagem de Membro Rede Demo: Quero trocar meu e-mail.',
        url: `/suporte/${C}`,
        tag: '1d000000000040008000000000000001',
        topic: '1d000000000040008000000000000001',
        urgency: 'high',
        renotify: true,
      },
    });
    // Never a bell row (D-228): push is the ONLY channel of both kinds.
    expect(intents[0]?.channels).not.toContain('in_app');
  });

  it('a member message with no live staff member notifies nobody', async () => {
    const tx = fakeTx(
      [row({ author_side: 'member', author_user_id: MEMBER })],
      [{ user_id: MEMBER }],
    );
    expect(await source.resolve(tx, payload('member', MEMBER), meta)).toEqual([]);
  });

  it('a non-support conversation, a missing message or a thread without a member yield []', async () => {
    expect(
      await source.resolve(fakeTx([row({ kind: 'direct' })]), payload('staff', STAFF), meta),
    ).toEqual([]);
    expect(await source.resolve(fakeTx([]), payload('staff', STAFF), meta)).toEqual([]);
    expect(
      await source.resolve(fakeTx([row({ member_user_id: null })]), payload('staff', STAFF), meta),
    ).toEqual([]);
  });

  it('the preview is cut on a word to 100 graphemes, newlines as spaces, with … only when cut', () => {
    const long = `${'palavra '.repeat(30)}fim`;
    const reply = supportReplyPushCopy(long);
    expect(
      [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(reply)].length,
    ).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(reply.endsWith('…')).toBe(true);
    expect(reply).not.toContain('palavr…');
    expect(supportReplyPushCopy('Linha 1\n\nLinha 2')).toBe('Linha 1 Linha 2');
    expect(supportReplyPushCopy('Curta')).toBe('Curta');

    const staffBody = memberMessagePushCopy('Íris Muñoz', long);
    expect(staffBody.startsWith('Nova mensagem de Íris Muñoz: palavra')).toBe(true);
    expect(staffBody.endsWith('…')).toBe(true);
    expect(
      [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(staffBody)].length,
    ).toBeLessThanOrEqual(CHAT_PUSH_BODY_MAX);
    expect(memberMessagePushCopy(null, 'Oi')).toBe('Nova mensagem de um membro: Oi');
  });
});
