import { describe, expect, it } from 'vitest';
import {
  CHAT_ISSUE_SET,
  CHAT_ISSUES,
  CHAT_MAX_BODY,
  CHAT_PAGE_SIZE,
  CHAT_PERMISSIONS,
  chatBodySchema,
  codePointLength,
  messageQuerySchema,
  messageRowSchema,
  sendMessageInputSchema,
  supportThreadSchema,
} from '../contracts/index';

/**
 * The published contract, pinned without a server: the body rule (D-225, CHAT-02 empty and
 * encoding), the seq query (D-240) and the strict rows a member reads (D-222).
 */

const ID = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';

const issuesOf = (value: unknown): string[] => {
  const parsed = chatBodySchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe('chat contracts', () => {
  it('names the two permissions and the closed issue vocabulary', () => {
    expect(CHAT_PERMISSIONS).toEqual({ answer: 'chat.support', contact: 'chat.support.contact' });
    expect(CHAT_ISSUES).toEqual([
      'body_required',
      'body_too_long',
      'member_blocked',
      'member_removed',
      'staff_has_inbox',
    ]);
    for (const issue of CHAT_ISSUES) expect(CHAT_ISSUE_SET.has(issue)).toBe(true);
  });

  it('CHAT-02 empty: an empty or whitespace-only body is body_required', () => {
    expect(issuesOf('')).toEqual(['body_required']);
    expect(issuesOf('   ')).toEqual(['body_required']);
    expect(issuesOf('\n\n\n')).toEqual(['body_required']);
    expect(issuesOf(' \t\r\n ')).toEqual(['body_required']);
  });

  it('stores the trimmed body with its inner line breaks as sent', () => {
    expect(chatBodySchema.parse('  Oi,\n\ntudo bem?  \n')).toBe('Oi,\n\ntudo bem?');
    expect(chatBodySchema.parse('<b>não é HTML</b>')).toBe('<b>não é HTML</b>');
  });

  it('CHAT-02 encoding: the limit counts code points, so 2,000 emoji pass and 2,001 do not', () => {
    const emoji = '😀'.repeat(CHAT_MAX_BODY);
    expect(emoji.length).toBe(CHAT_MAX_BODY * 2); // UTF-16 units: the wrong ruler
    expect(codePointLength(emoji)).toBe(CHAT_MAX_BODY);
    expect(issuesOf(emoji)).toEqual([]);
    expect(issuesOf(`${emoji}😀`)).toEqual(['body_too_long']);
    expect(issuesOf('a'.repeat(CHAT_MAX_BODY))).toEqual([]);
    expect(issuesOf('a'.repeat(CHAT_MAX_BODY + 1))).toEqual(['body_too_long']);
    // Surrounding whitespace does not count against the limit (it is trimmed away).
    expect(issuesOf(` ${'a'.repeat(CHAT_MAX_BODY)}\n`)).toEqual([]);
  });

  it('the send input is strict: an unknown key is refused', () => {
    expect(sendMessageInputSchema.safeParse({ body: 'oi' }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({ body: 'oi', seq: 9 }).success).toBe(false);
    expect(sendMessageInputSchema.safeParse({ body: 'oi', authorSide: 'staff' }).success).toBe(
      false,
    );
  });

  it('D-240: the seq query clamps limit and refuses both cursors at once', () => {
    expect(messageQuerySchema.parse({})).toEqual({ limit: CHAT_PAGE_SIZE });
    expect(messageQuerySchema.parse({ afterSeq: '3', limit: '2' })).toEqual({
      afterSeq: 3,
      limit: 2,
    });
    expect(messageQuerySchema.parse({ beforeSeq: '4', limit: '999' })).toEqual({
      beforeSeq: 4,
      limit: CHAT_PAGE_SIZE,
    });
    expect(messageQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(messageQuerySchema.safeParse({ afterSeq: '1', beforeSeq: '5' }).success).toBe(false);
    expect(messageQuerySchema.safeParse({ afterSeq: '-1' }).success).toBe(false);
    expect(messageQuerySchema.safeParse({ beforeSeq: '0' }).success).toBe(false);
    expect(messageQuerySchema.safeParse({ cursor: 'x' }).success).toBe(false);
  });

  it('D-222: a message row carries at most the first name of a staff author', () => {
    const staffRow = {
      id: ID,
      seq: 2,
      side: 'staff',
      body: 'Oi! Como posso ajudar?',
      createdAt: '2026-09-30T12:00:00.000000Z',
      author: { firstName: 'Carla' },
      authorIsViewer: false,
    };
    expect(messageRowSchema.parse(staffRow)).toEqual(staffRow);
    expect(
      messageRowSchema.safeParse({ ...staffRow, author: { firstName: 'Carla', avatar: 'x' } })
        .success,
    ).toBe(false);
    expect(messageRowSchema.safeParse({ ...staffRow, authorUserId: ID }).success).toBe(false);
  });

  it('D-220: a member with no conversation reads null and an empty list', () => {
    expect(
      supportThreadSchema.parse({ conversation: null, messages: [], hasOlder: false }),
    ).toEqual({ conversation: null, messages: [], hasOlder: false });
  });
});
