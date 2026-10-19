import { describe, expect, it } from 'vitest';
import { feedPostSchema, feedQuerySchema } from '../contracts/index';

/**
 * 09-03 (SOCIAL-03, SOCIAL-04, EXPL-02; D-471, D-473) expressed as the module's PUBLISHED CONTRACT,
 * asserted without a database: the new `scope` query key and the new optional `audience` post key.
 *
 * Two rules live here:
 *
 *  1. **`scope` is a closed, optional enum on a `.strict()` query.** The only value is `explorar`;
 *     any other string and any unknown key are refusals, so a typo cannot silently widen a read
 *     (the 03-03 rule).
 *  2. **`audience` is OPTIONAL and emitted only as `'followers'`** (the 08.2 Pitfall 10 rule): the
 *     schema is `.strict()` and the web parses with it, so an older web must never meet a new key
 *     while `social` is off for every tenant. Absent means the organization's voice.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const POST = {
  id: UUID,
  createdAt: '2026-10-19T12:00:00.000000Z',
  editedAt: null,
  caption: 'olá',
  author: { membershipId: OTHER_UUID, displayName: 'Helena', avatarAssetId: null },
  likeCount: 0,
  commentCount: 0,
  viewerLiked: false,
  communityId: null,
  community: null,
  canManage: true,
  mediaKind: 'none' as const,
  media: [],
  linkPreview: null,
};

describe('feedQuerySchema.scope (EXPL-02)', () => {
  it('1. parses { scope: "explorar" } and keeps the value', () => {
    const parsed = feedQuerySchema.safeParse({ scope: 'explorar' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.scope).toBe('explorar');
  });

  it('2. a query with no scope still parses and leaves scope undefined', () => {
    const parsed = feedQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.scope).toBeUndefined();
  });

  it('3. refuses any other scope value', () => {
    expect(feedQuerySchema.safeParse({ scope: 'seguindo' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ scope: '' }).success).toBe(false);
  });

  it('4. is still strict: an unknown key is refused next to a valid scope', () => {
    expect(feedQuerySchema.safeParse({ scope: 'explorar', ranking: 'top' }).success).toBe(false);
  });
});

describe('feedPostSchema.audience (D-471, D-473)', () => {
  it('5. parses a post with audience "followers" and keeps it', () => {
    const parsed = feedPostSchema.safeParse({ ...POST, audience: 'followers' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.audience).toBe('followers');
  });

  it('6. parses a post with no audience key (the organization voice)', () => {
    const parsed = feedPostSchema.safeParse(POST);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.audience).toBeUndefined();
  });

  it('7. refuses an audience outside the closed vocabulary', () => {
    expect(feedPostSchema.safeParse({ ...POST, audience: 'other' }).success).toBe(false);
  });
});
