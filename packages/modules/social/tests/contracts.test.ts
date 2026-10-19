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
  SOCIAL_MAX_PHOTO_BYTES,
  SOCIAL_MAX_PHOTOS_PER_POST,
  SOCIAL_MAX_VIDEO_BYTES,
  SOCIAL_MAX_VIDEO_SECONDS,
  SOCIAL_SETTINGS_DEFAULTS,
  socialListItemSchema,
  socialListPageSchema,
  socialListQuerySchema,
  socialSettingsPatchSchema,
  socialSettingsSchema,
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

/**
 * 09-06 (D-474, SOCIAL-05): the per-tenant member media limits stored in
 * `tenant_modules['social'].settings`. The read side is TOLERANT (an empty or malformed blob never
 * throws on a request path), the write side is a strict partial patch, and every cap equals the
 * admin limit of the same kind so a tenant can narrow the member allowance but never widen it.
 */
const MIB = 1024 * 1024;

describe('socialSettingsSchema (D-474)', () => {
  it('parses an empty blob to the documented defaults', () => {
    expect(socialSettingsSchema.parse({})).toEqual({
      media: {
        photoMaxBytes: 5 * MIB,
        photosPerPost: 4,
        video: { enabled: false, maxDurationSeconds: 60, maxBytes: 100 * MIB },
      },
    });
    expect(SOCIAL_SETTINGS_DEFAULTS.media).toEqual(socialSettingsSchema.parse({}).media);
  });

  it('pins the caps to the admin limits, so a tenant can narrow but never widen', () => {
    expect(SOCIAL_MAX_PHOTO_BYTES).toBe(15 * MIB);
    expect(SOCIAL_MAX_VIDEO_BYTES).toBe(500 * MIB);
    expect(SOCIAL_MAX_VIDEO_SECONDS).toBe(300);
    expect(SOCIAL_MAX_PHOTOS_PER_POST).toBe(10);
  });

  it('keeps the defaults of the keys a partial blob leaves out', () => {
    const parsed = socialSettingsSchema.parse({ media: { video: { enabled: true } } });
    expect(parsed.media.video).toEqual({
      enabled: true,
      maxDurationSeconds: 60,
      maxBytes: 100 * MIB,
    });
    expect(parsed.media.photoMaxBytes).toBe(5 * MIB);
  });

  it('accepts the boundary values and rejects one past them', () => {
    const ok = (media: Record<string, unknown>) =>
      socialSettingsSchema.safeParse({ media }).success;
    expect(ok({ photoMaxBytes: SOCIAL_MAX_PHOTO_BYTES })).toBe(true);
    expect(ok({ photoMaxBytes: SOCIAL_MAX_PHOTO_BYTES + 1 })).toBe(false);
    expect(ok({ photoMaxBytes: 1 })).toBe(true);
    expect(ok({ photoMaxBytes: 0 })).toBe(false);
    expect(ok({ photosPerPost: 10 })).toBe(true);
    expect(ok({ photosPerPost: 11 })).toBe(false);
    expect(ok({ photosPerPost: 0 })).toBe(false);
    expect(ok({ video: { maxDurationSeconds: 300 } })).toBe(true);
    expect(ok({ video: { maxDurationSeconds: 301 } })).toBe(false);
    expect(ok({ video: { maxBytes: SOCIAL_MAX_VIDEO_BYTES } })).toBe(true);
    expect(ok({ video: { maxBytes: SOCIAL_MAX_VIDEO_BYTES + 1 } })).toBe(false);
  });

  it('rejects a float, a negative and a string (EP-10: byte caps are integers)', () => {
    const bad = (media: Record<string, unknown>) =>
      socialSettingsSchema.safeParse({ media }).success;
    expect(bad({ photoMaxBytes: 1048576.5 })).toBe(false);
    expect(bad({ photoMaxBytes: -1 })).toBe(false);
    expect(bad({ photoMaxBytes: '1048576' })).toBe(false);
    expect(bad({ video: { maxDurationSeconds: 59.5 } })).toBe(false);
    expect(bad({ video: { enabled: 'true' } })).toBe(false);
  });
});

describe('socialSettingsPatchSchema (D-474, T-09-30)', () => {
  it('accepts a partial at every level and the empty patch', () => {
    expect(socialSettingsPatchSchema.safeParse({}).success).toBe(true);
    expect(socialSettingsPatchSchema.safeParse({ media: { photoMaxBytes: MIB } }).success).toBe(
      true,
    );
    expect(
      socialSettingsPatchSchema.safeParse({ media: { video: { enabled: true } } }).success,
    ).toBe(true);
  });

  it('rejects an unknown key at every level (.strict())', () => {
    expect(socialSettingsPatchSchema.safeParse({ other: 1 }).success).toBe(false);
    expect(socialSettingsPatchSchema.safeParse({ media: { extra: 1 } }).success).toBe(false);
    expect(socialSettingsPatchSchema.safeParse({ media: { video: { extra: 1 } } }).success).toBe(
      false,
    );
  });

  it('applies the same ranges as the read schema and adds no default', () => {
    expect(
      socialSettingsPatchSchema.safeParse({ media: { photoMaxBytes: SOCIAL_MAX_PHOTO_BYTES + 1 } })
        .success,
    ).toBe(false);
    expect(socialSettingsPatchSchema.parse({ media: { photosPerPost: 3 } })).toEqual({
      media: { photosPerPost: 3 },
    });
  });
});
