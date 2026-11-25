import { describe, expect, it } from 'vitest';
import {
  highlightSummarySchema,
  openHighlightCountsQuerySchema,
  openHighlightCountsSchema,
  publishStorySchema,
  STORY_AUTHORS_PAGE_SIZE,
  STORY_HIGHLIGHT_ISSUE_SET,
  STORY_HIGHLIGHT_ISSUES,
  storyAuthorCircleSchema,
  storyAuthorSchema,
  storyAuthorsPageSchema,
  storyAuthorsQuerySchema,
  storyPageSchema,
  storySummarySchema,
  updateHighlightSchema,
} from '../contracts/index';

/**
 * 10-07 (D-714, D-704): the member publish body is the organization's, unchanged. The audience of a
 * story is STAMPED by the service from the caller's role (backed by `stories_social_insert_gate` in SQL);
 * it is never a key a client can send, so the schema stays `.strict()` and names no audience.
 */

const ASSET = '0b000000-0000-4000-8000-000000000001';

describe('10-07 publishStorySchema: no client-visible audience', () => {
  it('accepts the plain body (the positive control for every refusal below)', () => {
    const parsed = publishStorySchema.safeParse({
      mediaAssetId: ASSET,
      mediaKind: 'image',
      caption: 'legenda',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a visibility key, whatever its value, and any other unknown key', () => {
    for (const extra of [
      { visibility: 'tenant' },
      { visibility: 'followers' },
      { authorUserId: '0a000000-0000-4000-8000-000000000001' },
      { communityId: ASSET },
    ]) {
      expect(
        publishStorySchema.safeParse({ mediaAssetId: ASSET, mediaKind: 'image', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

/**
 * 10-07 (A7, D-703's stance extended, T-10-29): the story wire names the author as `author` and sends the
 * author's user id only to the author. `authorUserId` is nullable; `author` carries exactly three fields
 * and defaults to null so a page from an API that predates it still parses.
 */
const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';
const OTHER = '0a000000-0000-4000-8000-000000000001';

function summary(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    authorUserId: OTHER,
    mediaAssetId: '0b000000-0000-4000-8000-000000000001',
    mediaKind: 'image',
    mediaVariantWidths: [640, 1080],
    mediaStatus: 'ready',
    mediaFailureReason: null,
    caption: '',
    publishedAt: '2026-10-03T12:00:00.000000Z',
    expiresAt: '2026-10-04T12:00:00.000000Z',
    isActive: true,
    durationSeconds: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    highlightCount: 0,
    viewerSeen: false,
    ...extra,
  };
}

describe('10-07 storySummarySchema: the author wire (A7)', () => {
  const author = {
    membershipId: OTHER,
    displayName: 'Helena Kuster',
    avatarUrl: '/v1/media/0b000000-0000-4000-8000-0000000000a1/w128',
  };

  it('parses a member story with a null authorUserId and an author of exactly three fields', () => {
    const parsed = storySummarySchema.parse(summary({ authorUserId: null, author }));
    expect(parsed.authorUserId).toBeNull();
    expect(parsed.author).toEqual(author);
  });

  it('parses the author’s own view (authorUserId present) and an organization story (author null)', () => {
    expect(storySummarySchema.parse(summary({ author })).authorUserId).toBe(OTHER);
    expect(
      storySummarySchema.parse(summary({ authorUserId: null, author: null })).author,
    ).toBeNull();
  });

  it('refuses a missing authorUserId key (it is nullable, not optional) and any extra or missing author field', () => {
    const { authorUserId: _omitted, ...withoutId } = summary();
    expect(storySummarySchema.safeParse(withoutId).success).toBe(false);
    for (const bad of [
      { ...author, userId: OTHER },
      { membershipId: OTHER, displayName: 'Helena' },
      { ...author, avatarUrl: 'https://evil.example/x.png' },
      { ...author, membershipId: 'not-a-uuid' },
    ]) {
      expect(
        storySummarySchema.safeParse(summary({ authorUserId: null, author: bad })).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('a page from an API that predates `author` still parses, every story with a null author', () => {
    const page = storyPageSchema.parse({ items: [summary(), summary()], nextCursor: null });
    expect(page.items.map((item) => item.author)).toEqual([null, null]);
  });
});

/**
 * 10-08 (D-714, D-717, T-10-30): the Explorar circle of one author (`storyAuthorCircleSchema`; `storyAuthorSchema`
 * stays the three-field `author` of a MEMBER story, 10-07). EXACTLY seven keys, `.strict()`: it names
 * the author by membership id (never a user id), carries the counts the ring needs and the caller's own seen
 * flag, and nothing else.
 */
describe('10-08 storyAuthorCircleSchema: the Explorar circle', () => {
  const item = {
    membershipId: OTHER,
    displayName: 'Helena Kuster',
    avatarUrl: '/v1/media/0b000000-0000-4000-8000-0000000000a1/w128',
    storyCount: 2,
    latestPublishedAt: '2026-11-11T12:00:00.000000Z',
    hasUnseen: true,
    isSelf: false,
  };

  it('parses an item of exactly the listed keys (avatarUrl may be null)', () => {
    expect(storyAuthorCircleSchema.parse(item)).toEqual(item);
    expect(storyAuthorCircleSchema.parse({ ...item, avatarUrl: null }).avatarUrl).toBeNull();
  });

  it('refuses an extra userId key, a missing key and a non-uuid membership id', () => {
    for (const bad of [
      { ...item, userId: UUID },
      { ...item, authorUserId: UUID },
      { ...item, isSelf: undefined },
      { ...item, membershipId: 'not-a-uuid' },
      { ...item, storyCount: 1.5 },
    ]) {
      expect(storyAuthorCircleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('the story’s own three-field author is a different schema and refuses the circle’s extra keys', () => {
    expect(storyAuthorSchema.safeParse({ ...item }).success).toBe(false);
    expect(
      storyAuthorSchema.safeParse({
        membershipId: item.membershipId,
        displayName: item.displayName,
        avatarUrl: item.avatarUrl,
      }).success,
    ).toBe(true);
  });

  it('wraps the items in a strict page with a nullable cursor, and the page size is 20', () => {
    expect(storyAuthorsPageSchema.parse({ items: [item], nextCursor: null }).items).toHaveLength(1);
    expect(
      storyAuthorsPageSchema.safeParse({ items: [item], nextCursor: null, x: 1 }).success,
    ).toBe(false);
    expect(STORY_AUTHORS_PAGE_SIZE).toBe(20);
  });

  it('the query clamps limit to 1..50, defaults to 20 and degrades a malformed limit', () => {
    expect(storyAuthorsQuerySchema.parse({}).limit).toBe(20);
    expect(storyAuthorsQuerySchema.parse({ limit: '2' }).limit).toBe(2);
    expect(storyAuthorsQuerySchema.parse({ limit: '900' }).limit).toBe(50);
    expect(storyAuthorsQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(storyAuthorsQuerySchema.parse({ limit: 'abc' }).limit).toBe(20);
    expect(storyAuthorsQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

/**
 * 11-15 (D-733, MODER-05): `canReport` and `canBlock` ride the story summary as OPTIONAL booleans on the strict
 * schema, so a new web tolerates an old API (a fixture without them parses) and nothing else about the shape moves.
 */
describe('11-15 storySummarySchema: the report riders', () => {
  it('parses a fixture without the riders (an API that predates them) and leaves them absent', () => {
    const parsed = storySummarySchema.parse(summary());
    expect(parsed).not.toHaveProperty('canReport');
    expect(parsed).not.toHaveProperty('canBlock');
  });

  it('parses both riders as booleans and refuses any other type or any other new key', () => {
    const parsed = storySummarySchema.parse(summary({ canReport: true, canBlock: false }));
    expect(parsed.canReport).toBe(true);
    expect(parsed.canBlock).toBe(false);
    expect(storySummarySchema.safeParse(summary({ canBlock: 'yes' })).success).toBe(false);
    expect(storySummarySchema.safeParse(summary({ canBlocked: true })).success).toBe(false);
  });

  it('a page whose items carry the riders still parses (the strip and the author read)', () => {
    const page = storyPageSchema.parse({
      items: [summary({ canReport: true, canBlock: true }), summary()],
      nextCursor: null,
    });
    expect(page.items.map((item) => item.canBlock)).toEqual([true, undefined]);
  });
});

describe('11.1 highlight openToBuyers, its issue code and the open-counts schemas (D-884, UI-D-886)', () => {
  const HIGHLIGHT = {
    id: ASSET,
    communityId: null,
    title: 'Aulas',
    position: 0,
    coverAssetId: null,
    coverVariantWidths: [],
    coverStoryId: null,
    coverChosen: false,
    itemCount: 0,
  };
  const COMMUNITY = '0c000000-0000-4000-8000-000000000001';
  const OTHER = '0c000000-0000-4000-8000-000000000002';

  it('the issue vocabulary is pinned, open_unavailable last, and the lookup carries it', () => {
    expect([...STORY_HIGHLIGHT_ISSUES]).toEqual([
      'archived',
      'title_invalid',
      'order_stale',
      'full',
      'open_unavailable',
    ]);
    expect(STORY_HIGHLIGHT_ISSUE_SET.has('open_unavailable')).toBe(true);
    expect(STORY_HIGHLIGHT_ISSUE_SET.has('not_found')).toBe(false);
  });

  it('highlightSummarySchema: openToBuyers is optional and boolean; an old row parses and stays free of it', () => {
    expect(highlightSummarySchema.parse(HIGHLIGHT)).not.toHaveProperty('openToBuyers');
    expect(highlightSummarySchema.parse({ ...HIGHLIGHT, openToBuyers: true }).openToBuyers).toBe(
      true,
    );
    expect(highlightSummarySchema.safeParse({ ...HIGHLIGHT, openToBuyers: 'on' }).success).toBe(
      false,
    );
    expect(highlightSummarySchema.safeParse({ ...HIGHLIGHT, openToByers: true }).success).toBe(
      false,
    );
  });

  it('updateHighlightSchema: openToBuyers alone is a valid patch, an empty body and unknown keys are not', () => {
    expect(updateHighlightSchema.parse({ openToBuyers: false })).toEqual({ openToBuyers: false });
    expect(updateHighlightSchema.safeParse({ title: 'Novo' }).success).toBe(true);
    expect(updateHighlightSchema.safeParse({ openToBuyers: 1 }).success).toBe(false);
    expect(updateHighlightSchema.safeParse({}).success).toBe(false);
    expect(
      updateHighlightSchema.safeParse({ openToBuyers: true, productId: COMMUNITY }).success,
    ).toBe(false);
  });

  it('openHighlightCountsQuerySchema: one to 50 comma-separated uuids, deduplicated, strict', () => {
    expect(openHighlightCountsQuerySchema.parse({ communityIds: COMMUNITY }).communityIds).toEqual([
      COMMUNITY,
    ]);
    expect(
      openHighlightCountsQuerySchema.parse({ communityIds: `${COMMUNITY},${OTHER},${COMMUNITY}` })
        .communityIds,
    ).toEqual([COMMUNITY, OTHER]);
    const fifty = Array.from(
      { length: 50 },
      (_, i) => `0c000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
    );
    expect(
      openHighlightCountsQuerySchema.safeParse({ communityIds: fifty.join(',') }).success,
    ).toBe(true);
    expect(
      openHighlightCountsQuerySchema.safeParse({
        communityIds: [...fifty, `0c000000-0000-4000-8000-${'9'.padStart(12, '0')}`].join(','),
      }).success,
    ).toBe(false);
    for (const bad of ['', 'nope', `${COMMUNITY},nope`, `${COMMUNITY},`]) {
      expect(openHighlightCountsQuerySchema.safeParse({ communityIds: bad }).success, bad).toBe(
        false,
      );
    }
    expect(openHighlightCountsQuerySchema.safeParse({}).success).toBe(false);
    expect(
      openHighlightCountsQuerySchema.safeParse({ communityIds: COMMUNITY, limit: 1 }).success,
    ).toBe(false);
  });

  it('openHighlightCountsSchema: items of communityId and a non-negative integer, strict', () => {
    expect(openHighlightCountsSchema.parse({ items: [] })).toEqual({ items: [] });
    const row = { communityId: COMMUNITY, openHighlights: 0 };
    expect(
      openHighlightCountsSchema.parse({ items: [row, { ...row, openHighlights: 3 }] }).items,
    ).toHaveLength(2);
    expect(
      openHighlightCountsSchema.safeParse({ items: [{ ...row, openHighlights: -1 }] }).success,
    ).toBe(false);
    expect(
      openHighlightCountsSchema.safeParse({ items: [{ ...row, openHighlights: 1.5 }] }).success,
    ).toBe(false);
    expect(openHighlightCountsSchema.safeParse({ items: [{ ...row, title: 'x' }] }).success).toBe(
      false,
    );
    expect(openHighlightCountsSchema.safeParse({ items: [], total: 1 }).success).toBe(false);
  });
});
