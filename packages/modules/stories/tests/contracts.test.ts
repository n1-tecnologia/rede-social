import { describe, expect, it } from 'vitest';
import { publishStorySchema, storyPageSchema, storySummarySchema } from '../contracts/index';

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
