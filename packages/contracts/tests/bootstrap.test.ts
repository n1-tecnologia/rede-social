import { describe, expect, it } from 'vitest';
import { countersSchema } from '../src/bootstrap';

/**
 * 07 review A-WR-07: an additive bootstrap field is tolerant on the reader side, so a web build that
 * goes live before the API revision that sends it (or an API rollback) never fails the parse.
 */
describe('bootstrap counters contract', () => {
  it('reads an absent conversationsBadge as the kernel default count', () => {
    expect(countersSchema.parse({ unreadNotifications: 2, unreadConversations: 1 })).toEqual({
      unreadNotifications: 2,
      unreadConversations: 1,
      conversationsBadge: 'count',
    });
  });

  it('keeps the value the API sends, and still refuses a value outside the enum', () => {
    expect(
      countersSchema.parse({
        unreadNotifications: 0,
        unreadConversations: 1,
        conversationsBadge: 'dot',
      }).conversationsBadge,
    ).toBe('dot');
    expect(
      countersSchema.safeParse({
        unreadNotifications: 0,
        unreadConversations: 1,
        conversationsBadge: 'badge',
      }).success,
    ).toBe(false);
  });
});
