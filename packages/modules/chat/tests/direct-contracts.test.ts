import { describe, expect, it } from 'vitest';
import {
  CHAT_ISSUE_SET,
  CHAT_ISSUES,
  CHAT_MAX_BODY,
  CHAT_NOTIFICATION_KINDS,
  CHAT_PERMISSIONS,
  DIRECT_COMPOSER_STATES,
  DIRECT_LIST_PAGE_SIZE,
  DIRECT_UNREAD_CAP,
  directDetailParamsSchema,
  directDetailSchema,
  directListAnswerSchema,
  directListQuerySchema,
  directListRowSchema,
  directPreviewSchema,
  directSendInputSchema,
  directSendResultSchema,
  directWithAnswerSchema,
  directWithParamsSchema,
  messageRowSchema,
} from '../contracts/index';

/**
 * Phase 11 plan 08 (CHAT-06; D-719, D-720, D-722): the published contract of the direct conversation, pinned
 * without a server. The closed vocabulary only ever grows at its END, and every new schema is strict so a client
 * cannot slip a user id, a conversation id, a tenant id or an author side into a send.
 */

const ID = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const ID2 = '3f1c59a8-6a43-4a06-a1d5-0f4c1f2c8f01';
const MESSAGE = {
  id: ID,
  seq: 1,
  side: 'member',
  body: 'Oi',
  createdAt: '2026-11-19T12:00:00.000000Z',
  author: null,
  authorIsViewer: true,
};

describe('direct chat contracts (11-08)', () => {
  it('D-719: `chat.direct` is a fourth permission string, beside the three support ones', () => {
    expect(CHAT_PERMISSIONS.direct).toBe('chat.direct');
    expect(CHAT_PERMISSIONS).toEqual({
      answer: 'chat.support',
      contact: 'chat.support.contact',
      assign: 'chat.support.assign',
      direct: 'chat.direct',
    });
  });

  it('D-722: `direct_closed` is appended at the END of the closed issue list, after the voice words', () => {
    expect(CHAT_ISSUES.at(-1)).toBe('direct_closed');
    expect(CHAT_ISSUES.slice(-3)).toEqual(['voice_not_ready', 'voice_invalid', 'direct_closed']);
    expect(CHAT_ISSUE_SET.has('direct_closed')).toBe(true);
    // The word the staff side uses for an administrator block is never reused for a member block.
    expect(CHAT_ISSUES.filter((issue) => issue === 'member_blocked')).toHaveLength(1);
    expect('direct_closed').not.toBe('member_blocked');
  });

  it('the direct message notification kind and the four composer states are closed words', () => {
    expect(CHAT_NOTIFICATION_KINDS.directMessage).toBe('chat.direct_message');
    expect(DIRECT_COMPOSER_STATES).toEqual(['open', 'closed', 'blocker', 'removed']);
  });

  it('D-720: the send input is strict: a membership id and a body, nothing else', () => {
    expect(directSendInputSchema.parse({ toMembershipId: ID, body: '  Oi  ' })).toEqual({
      toMembershipId: ID,
      body: 'Oi',
    });
    for (const extra of [
      { userId: ID2 },
      { conversationId: ID2 },
      { tenantId: ID2 },
      { side: 'staff' },
      { authorSide: 'member' },
    ]) {
      expect(
        directSendInputSchema.safeParse({ toMembershipId: ID, body: 'Oi', ...extra }).success,
      ).toBe(false);
    }
    expect(directSendInputSchema.safeParse({ body: 'Oi' }).success).toBe(false);
    expect(
      directSendInputSchema.safeParse({ toMembershipId: 'not-a-uuid', body: 'Oi' }).success,
    ).toBe(false);
  });

  it('CHAT-06 encoding: the body rule is the shared one, counted in code points after trim', () => {
    const parse = (body: string) =>
      directSendInputSchema.safeParse({ toMembershipId: ID, body }).success;
    expect(parse('😀'.repeat(CHAT_MAX_BODY))).toBe(true);
    expect(parse('😀'.repeat(CHAT_MAX_BODY + 1))).toBe(false);
    expect(parse('é'.repeat(CHAT_MAX_BODY / 2))).toBe(true);
    expect(parse('   \n\t  ')).toBe(false);
    expect(parse('')).toBe(false);
    const messages = (body: string) => {
      const parsed = directSendInputSchema.safeParse({ toMembershipId: ID, body });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    expect(messages('   ')).toEqual(['body_required']);
    expect(messages('x'.repeat(CHAT_MAX_BODY + 1))).toEqual(['body_too_long']);
  });

  it('the with params are a strict membership id', () => {
    expect(directWithParamsSchema.safeParse({ membershipId: ID }).success).toBe(true);
    expect(directWithParamsSchema.safeParse({ membershipId: 'x' }).success).toBe(false);
    expect(directWithParamsSchema.safeParse({ membershipId: ID, extra: 1 }).success).toBe(false);
  });

  it('D-720: the with answer carries the conversation or null, the other member and the composer, strictly', () => {
    const answer = {
      conversationId: null,
      other: { membershipId: ID, displayName: 'Ana', avatarAssetId: null, removed: false },
      composer: 'open',
    };
    expect(directWithAnswerSchema.safeParse(answer).success).toBe(true);
    expect(directWithAnswerSchema.safeParse({ ...answer, conversationId: ID2 }).success).toBe(true);
    for (const composer of DIRECT_COMPOSER_STATES) {
      expect(directWithAnswerSchema.safeParse({ ...answer, composer }).success).toBe(true);
    }
    expect(directWithAnswerSchema.safeParse({ ...answer, composer: 'blocked' }).success).toBe(
      false,
    );
    // No flag that says "blocked me" and no extra key anywhere.
    expect(directWithAnswerSchema.safeParse({ ...answer, blockedMe: true }).success).toBe(false);
    expect(
      directWithAnswerSchema.safeParse({
        ...answer,
        other: { ...answer.other, blocked: true },
      }).success,
    ).toBe(false);
  });

  it('the send result is the support one without a case, plus whether this call created the conversation', () => {
    const result = { conversationId: ID, created: true, message: MESSAGE };
    expect(directSendResultSchema.safeParse(result).success).toBe(true);
    // No support-case key: a direct conversation has no case.
    expect(directSendResultSchema.safeParse({ ...result, case: { id: ID } }).success).toBe(false);
    expect(directSendResultSchema.safeParse({ ...result, extra: 1 }).success).toBe(false);
    expect(directSendResultSchema.safeParse({ conversationId: ID, message: MESSAGE }).success).toBe(
      false,
    );
    expect(messageRowSchema.safeParse(MESSAGE).success).toBe(true);
  });
});

describe('direct list and detail contracts (11-10)', () => {
  const OTHER = { membershipId: ID, displayName: 'Ana', avatarAssetId: null, removed: false };
  const ROW = {
    conversationId: ID2,
    other: OTHER,
    lastPreview: { kind: 'text', text: 'Oi', own: false },
    lastMessageAt: '2026-11-19T12:00:00.000000Z',
    unreadCount: 3,
  };

  it('D-719: the page is 20 and the unread number is capped at 100', () => {
    expect(DIRECT_LIST_PAGE_SIZE).toBe(20);
    expect(DIRECT_UNREAD_CAP).toBe(100);
  });

  it('the list query is strict, clamps the limit and drops an over-long cursor instead of failing', () => {
    expect(directListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(directListQuerySchema.parse({ limit: '2' }).limit).toBe(2);
    expect(directListQuerySchema.parse({ limit: '500' }).limit).toBe(20);
    expect(directListQuerySchema.parse({ limit: 'abc' }).limit).toBe(20);
    expect(directListQuerySchema.parse({ cursor: 'x'.repeat(600) }).cursor).toBeUndefined();
    expect(directListQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('the preview is a discriminated object: text, or a recording with its stored length', () => {
    expect(directPreviewSchema.safeParse({ kind: 'text', text: 'Oi', own: true }).success).toBe(
      true,
    );
    expect(
      directPreviewSchema.safeParse({ kind: 'voice', durationSeconds: 12, own: false }).success,
    ).toBe(true);
    expect(
      directPreviewSchema.safeParse({
        kind: 'voice',
        durationSeconds: 12,
        own: false,
        deleted: true,
      }).success,
    ).toBe(true);
    expect(directPreviewSchema.safeParse({ kind: 'voice', own: false }).success).toBe(false);
    expect(
      directPreviewSchema.safeParse({ kind: 'text', text: 'Oi', own: true, deleted: true }).success,
    ).toBe(false);
    expect(directPreviewSchema.safeParse({ kind: 'image', own: true }).success).toBe(false);
  });

  it('the row is strict, the unread count is 0..100 and the other member may be removed', () => {
    expect(directListRowSchema.safeParse(ROW).success).toBe(true);
    expect(directListRowSchema.safeParse({ ...ROW, unreadCount: 100 }).success).toBe(true);
    expect(directListRowSchema.safeParse({ ...ROW, unreadCount: 101 }).success).toBe(false);
    expect(directListRowSchema.safeParse({ ...ROW, unreadCount: -1 }).success).toBe(false);
    expect(
      directListRowSchema.safeParse({
        ...ROW,
        other: { membershipId: null, displayName: null, avatarAssetId: null, removed: true },
      }).success,
    ).toBe(true);
    expect(directListRowSchema.safeParse({ ...ROW, blocked: false }).success).toBe(false);
    expect(
      directListRowSchema.safeParse({ ...ROW, other: { ...OTHER, blockedMe: true } }).success,
    ).toBe(false);
  });

  it('the answer carries the support summary on the first page only, and never a staff id or a priority', () => {
    const support = { lastPreview: null, unread: false };
    expect(
      directListAnswerSchema.safeParse({ support, rows: [ROW], nextCursor: null }).success,
    ).toBe(true);
    expect(directListAnswerSchema.safeParse({ rows: [], nextCursor: 'abc' }).success).toBe(true);
    expect(
      directListAnswerSchema.safeParse({
        support: { ...support, priority: 'high' },
        rows: [],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      directListAnswerSchema.safeParse({
        support: { ...support, ownerUserId: ID },
        rows: [],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it('D-722: the detail has the composer word and nothing that says blocked', () => {
    const detail = {
      conversationId: ID2,
      other: OTHER,
      composer: 'closed',
      canBlock: true,
      lastSeq: 4,
      lastReadSeq: 2,
    };
    expect(directDetailSchema.safeParse(detail).success).toBe(true);
    for (const composer of DIRECT_COMPOSER_STATES) {
      expect(directDetailSchema.safeParse({ ...detail, composer }).success).toBe(true);
    }
    expect(directDetailSchema.safeParse({ ...detail, blockedByViewer: true }).success).toBe(false);
    expect(directDetailSchema.safeParse({ ...detail, blockedMe: true }).success).toBe(false);
    expect(directDetailSchema.safeParse({ ...detail, composer: 'blocked' }).success).toBe(false);
    expect(directDetailParamsSchema.safeParse({ conversationId: ID2 }).success).toBe(true);
    expect(directDetailParamsSchema.safeParse({ conversationId: 'x' }).success).toBe(false);
    expect(directDetailParamsSchema.safeParse({ conversationId: ID2, extra: 1 }).success).toBe(
      false,
    );
  });
});
