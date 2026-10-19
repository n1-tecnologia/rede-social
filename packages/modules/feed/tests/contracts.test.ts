import { describe, expect, it } from 'vitest';
import {
  FEED_COMMUNITY_ISSUES,
  FEED_MEDIA_ISSUES,
  FEED_MEMBER_ISSUES,
  feedPageSchema,
  feedPostSchema,
  feedQuerySchema,
  postLockedAuthorSchema,
} from '../contracts/index';

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

describe('feedPageSchema.followsAnyone (UI-D-494, 09-04)', () => {
  const PAGE = { items: [], nextCursor: null };

  it('8. parses a page with followsAnyone true and keeps it', () => {
    const parsed = feedPageSchema.safeParse({ ...PAGE, followsAnyone: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.followsAnyone).toBe(true);
  });

  it('9. parses a page with followsAnyone false and keeps it', () => {
    const parsed = feedPageSchema.safeParse({ ...PAGE, followsAnyone: false });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.followsAnyone).toBe(false);
  });

  it('10. parses a page without the key (every non-Explorar read and every non-empty page)', () => {
    const parsed = feedPageSchema.safeParse({ ...PAGE, items: [POST] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.followsAnyone).toBeUndefined();
  });

  it('11. refuses a non-boolean followsAnyone', () => {
    expect(feedPageSchema.safeParse({ ...PAGE, followsAnyone: 'yes' }).success).toBe(false);
  });
});

describe('postLockedAuthorSchema (D-469, 09-05): what a stranger learns about a followers-only post', () => {
  const AUTHOR = { membershipId: OTHER_UUID, displayName: 'Helena Küster', avatarAssetId: null };

  it('12. parses the author and keeps the three keys', () => {
    const parsed = postLockedAuthorSchema.safeParse(AUTHOR);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(AUTHOR);
  });

  it('13. accepts an avatar asset id', () => {
    expect(postLockedAuthorSchema.safeParse({ ...AUTHOR, avatarAssetId: UUID }).success).toBe(true);
  });

  it('14. refuses an extra key such as caption: the locked answer discloses nothing else (PR-2)', () => {
    expect(postLockedAuthorSchema.safeParse({ ...AUTHOR, caption: 'segredo' }).success).toBe(false);
    expect(postLockedAuthorSchema.safeParse({ ...AUTHOR, likeCount: 3 }).success).toBe(false);
  });

  it('15. refuses a missing display name and a non-uuid membership id', () => {
    expect(postLockedAuthorSchema.safeParse({ ...AUTHOR, displayName: undefined }).success).toBe(
      false,
    );
    expect(postLockedAuthorSchema.safeParse({ ...AUTHOR, membershipId: 'x' }).success).toBe(false);
  });
});

/**
 * 09-06 (D-473): the member authoring refusals live in their OWN closed set, carried as
 * `details.member`. The web switches exhaustively on the media and community sets ("a new refusal
 * code cannot compile until it has copy"), so adding a word to either would break the web before the
 * composer plan gives it copy; a separate set changes no existing switch.
 */
describe('FEED_MEMBER_ISSUES (D-473)', () => {
  it('is exactly the three member refusals, in this order', () => {
    expect([...FEED_MEMBER_ISSUES]).toEqual([
      'member_no_attachments',
      'member_no_community',
      'member_video_off',
    ]);
  });

  it('leaves the media and community vocabularies exactly as they were', () => {
    expect([...FEED_MEDIA_ISSUES]).toEqual([
      'too_many_images',
      'too_many_attachments',
      'gallery_and_video',
      'asset_not_usable',
    ]);
    expect([...FEED_COMMUNITY_ISSUES]).toEqual(['archived']);
  });

  it('shares no word with the media or community sets', () => {
    const others = new Set<string>([...FEED_MEDIA_ISSUES, ...FEED_COMMUNITY_ISSUES]);
    for (const word of FEED_MEMBER_ISSUES) expect(others.has(word)).toBe(false);
  });
});

/**
 * 09-07 (D-475): `removal` tells a holder of `moderation.manage` that a member post is theirs to
 * take down. OPTIONAL and emitted only as `'moderation'` (the 08.2 Pitfall 10 rule): the schema is
 * `.strict()` and the web parses with it, so an older web must never meet a new key while `social`
 * is off for every tenant. `canManage` stays author-only.
 */
describe('feedPostSchema.removal (D-475)', () => {
  it('parses a post with removal "moderation" and keeps it', () => {
    const parsed = feedPostSchema.safeParse({ ...POST, canManage: false, removal: 'moderation' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.removal).toBe('moderation');
  });

  it('parses a post with no removal key and leaves it undefined', () => {
    const parsed = feedPostSchema.safeParse(POST);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.removal).toBeUndefined();
  });

  it('refuses null, "own" and any other value: the key is never emitted as null', () => {
    expect(feedPostSchema.safeParse({ ...POST, removal: null }).success).toBe(false);
    expect(feedPostSchema.safeParse({ ...POST, removal: 'own' }).success).toBe(false);
    expect(feedPostSchema.safeParse({ ...POST, removal: 'admin' }).success).toBe(false);
  });
});
