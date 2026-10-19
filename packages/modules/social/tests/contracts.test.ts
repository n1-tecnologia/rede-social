import { memberProfileSchema } from '@rede-social/contracts/profiles';
import { describe, expect, it } from 'vitest';
import {
  followResultSchema,
  followStateBodySchema,
  followStateSchema,
  memberSocialProfileSchema,
  SOCIAL_FOLLOW_ISSUES,
  SOCIAL_LIST_MAX_PAGE_SIZE,
  SOCIAL_LIST_PAGE_SIZE,
  socialListItemSchema,
  socialListPageSchema,
  socialListQuerySchema,
} from '../contracts/index';

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

const ID = '6f1c1c52-3b5b-4a53-9a8e-0a1b2c3d4e5f';
const ID_B = '7a2d2d63-4c6c-4b64-8b9f-1b2c3d4e5f60';
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('memberSocialProfileSchema (FOLLOW-04, EP-40, EP-41)', () => {
  const social = {
    membershipId: ID,
    followerCount: 0,
    followingCount: 0,
    viewerFollows: false,
    self: false,
  };

  it('parses the zero-relations shape', () => {
    expect(memberSocialProfileSchema.parse(social)).toEqual(social);
  });

  it('rejects a missing key, each one', () => {
    for (const key of Object.keys(social)) {
      const { [key as keyof typeof social]: _omitted, ...rest } = social;
      expect(memberSocialProfileSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it('rejects an extra key (.strict(), so the shape cannot drift)', () => {
    expect(memberSocialProfileSchema.safeParse({ ...social, role: 'member' }).success).toBe(false);
  });

  it('rejects a negative count', () => {
    expect(memberSocialProfileSchema.safeParse({ ...social, followerCount: -1 }).success).toBe(
      false,
    );
    expect(memberSocialProfileSchema.safeParse({ ...social, followingCount: -1 }).success).toBe(
      false,
    );
  });
});

describe('the base memberProfileSchema stays D-45 (EP-40)', () => {
  const base = {
    membershipId: ID,
    displayName: 'Helena',
    bio: null,
    avatarAssetId: null,
    avatarUrl: null,
  };

  it('parses the plain profile', () => {
    expect(memberProfileSchema.safeParse(base).success).toBe(true);
  });

  it('still rejects a role, a follower count and a following count', () => {
    expect(memberProfileSchema.safeParse({ ...base, role: 'admin_tenant' }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...base, followerCount: 1 }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...base, followingCount: 1 }).success).toBe(false);
  });
});

describe('followStateBodySchema (batch state)', () => {
  it('accepts 1 and 50 ids', () => {
    expect(followStateBodySchema.safeParse({ membershipIds: ids(1) }).success).toBe(true);
    expect(followStateBodySchema.safeParse({ membershipIds: ids(50) }).success).toBe(true);
  });

  it('rejects 0 and 51 ids', () => {
    expect(followStateBodySchema.safeParse({ membershipIds: [] }).success).toBe(false);
    expect(followStateBodySchema.safeParse({ membershipIds: ids(51) }).success).toBe(false);
  });

  it('rejects a non-uuid and an extra key', () => {
    expect(followStateBodySchema.safeParse({ membershipIds: ['nope'] }).success).toBe(false);
    expect(followStateBodySchema.safeParse({ membershipIds: ids(1), x: 1 }).success).toBe(false);
  });

  it('followStateSchema parses one item per id', () => {
    const body = {
      items: [
        { membershipId: ID, following: true },
        { membershipId: ID_B, following: false },
      ],
    };
    expect(followStateSchema.parse(body)).toEqual(body);
    expect(followStateSchema.safeParse({ items: [{ membershipId: ID }] }).success).toBe(false);
  });
});

describe('socialListQuerySchema and the list page (EP-38)', () => {
  it('defaults limit to 25 and exposes the page sizes', () => {
    expect(SOCIAL_LIST_PAGE_SIZE).toBe(25);
    expect(SOCIAL_LIST_MAX_PAGE_SIZE).toBe(50);
    expect(socialListQuerySchema.parse({}).limit).toBe(25);
  });

  it('coerces a query-string limit and refuses above 50 and below 1', () => {
    expect(socialListQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(socialListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(socialListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('refuses an unknown key, so no member id can ride along (D-468)', () => {
    expect(socialListQuerySchema.safeParse({ membershipId: ID }).success).toBe(false);
    expect(socialListQuerySchema.safeParse({ userId: ID }).success).toBe(false);
  });

  it('parses an empty page and a one-item page; the item is strict', () => {
    expect(socialListPageSchema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
    const item = {
      membershipId: ID,
      displayName: 'Helena',
      bio: null,
      avatarAssetId: null,
      viewerFollows: true,
    };
    expect(socialListItemSchema.parse(item)).toEqual(item);
    expect(socialListItemSchema.safeParse({ ...item, role: 'member' }).success).toBe(false);
    expect(socialListPageSchema.parse({ items: [item], nextCursor: 'abc' }).nextCursor).toBe('abc');
  });
});
