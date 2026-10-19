import { describe, expect, it } from 'vitest';
import { followResultSchema, SOCIAL_FOLLOW_ISSUES } from '../contracts/index';

/**
 * 09-02 (FOLLOW-01, D-467): the follow answer and its closed refusal vocabulary, as data. The schema
 * is `.strict()` so the shape the API sends and the web parses cannot drift.
 */
describe('followResultSchema (FOLLOW-01)', () => {
  it('parses a follow answer with a non-negative integer count', () => {
    expect(followResultSchema.parse({ following: true, followerCount: 3 })).toEqual({
      following: true,
      followerCount: 3,
    });
    expect(followResultSchema.parse({ following: false, followerCount: 0 }).followerCount).toBe(0);
  });

  it('rejects a negative count', () => {
    expect(followResultSchema.safeParse({ following: true, followerCount: -1 }).success).toBe(
      false,
    );
  });

  it('rejects a fractional count', () => {
    expect(followResultSchema.safeParse({ following: true, followerCount: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects a missing key, either one', () => {
    expect(followResultSchema.safeParse({ following: true }).success).toBe(false);
    expect(followResultSchema.safeParse({ followerCount: 2 }).success).toBe(false);
  });

  it('rejects an extra key (.strict())', () => {
    expect(
      followResultSchema.safeParse({ following: true, followerCount: 2, extra: 1 }).success,
    ).toBe(false);
  });
});

describe('SOCIAL_FOLLOW_ISSUES (D-467)', () => {
  it('is exactly the one closed code a follow can be refused with', () => {
    expect([...SOCIAL_FOLLOW_ISSUES]).toEqual(['self_follow']);
  });
});
