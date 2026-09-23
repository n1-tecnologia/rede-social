import { describe, expect, it } from 'vitest';
import {
  createPostSchema,
  FEED_COMMUNITY_ISSUE_SET,
  FEED_COMMUNITY_ISSUES,
  feedPostSchema,
  feedQuerySchema,
  postCommunitySchema,
  updatePostSchema,
} from '../contracts/index';

/**
 * D-72 / D-71 / COMM-04 expressed as the module's PUBLISHED CONTRACT, asserted without a database.
 *
 * Four rules live here, and each one is a sentence the wire shape either keeps or breaks:
 *
 *  1. **A destination is chosen at publication and never after** (D-72). `communityId` is accepted
 *     by `createPostSchema` and is NOT a key of `updatePostSchema` — and because both schemas are
 *     `.strict()`, "not a key" is a REFUSAL rather than a silently dropped field. A published post
 *     therefore cannot be moved between communities by any caller, composer or not.
 *  2. **Every post says where it came from** (D-71). `feedPostSchema.community` is REQUIRED and
 *     nullable: a tenant-wide post carries `null`, a community post carries `{ id, name, slug }`,
 *     and there is no third state a renderer would have to guess at. The summary is `.strict()`, so
 *     the label can never quietly start carrying a cover, a status or a post count.
 *  3. **`archived` is a MACHINE code in a closed vocabulary** (COMM-04). The web switches on it
 *     exhaustively, exactly as it does on `FEED_MEDIA_ISSUES`, and the pt-BR copy lives in the
 *     catalog — never here.
 *  4. **The community feed is the SAME endpoint** (D-73): `communityId` is an optional query key on
 *     `feedQuerySchema`, not a second contract, and the schema is still `.strict()` so a typo in it
 *     fails loudly instead of silently widening the read.
 *
 * The SQL half of D-73/D-74 (which predicate the merged feed carries, and which index serves it)
 * cannot be proved without Postgres: `apps/api/tests/integration/{feed,communities}.test.ts` and
 * `supabase/tests/090-feed.sql` own it.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const POST = {
  id: UUID,
  createdAt: '2026-09-23T12:00:00.000000Z',
  editedAt: null,
  caption: 'olá',
  author: { membershipId: OTHER_UUID, displayName: 'Admin', avatarAssetId: null },
  likeCount: 0,
  commentCount: 0,
  viewerLiked: false,
  communityId: null as string | null,
  community: null as { id: string; name: string; slug: string } | null,
  canManage: true,
  mediaKind: 'none' as const,
  media: [],
  linkPreview: null,
};

describe('D-72 — a destination is chosen at publication and never after', () => {
  it('1. createPostSchema ACCEPTS communityId and keeps the value', () => {
    const parsed = createPostSchema.safeParse({ caption: 'aviso', communityId: UUID });
    expect(parsed.success, 'createPostSchema must accept communityId').toBe(true);
    expect(parsed.success && parsed.data.communityId).toBe(UUID);
  });

  it('2. createPostSchema refuses a communityId that is not a uuid', () => {
    expect(createPostSchema.safeParse({ caption: 'aviso', communityId: 'nope' }).success).toBe(
      false,
    );
  });

  it('3. a post with no destination parses, and communityId stays undefined', () => {
    const parsed = createPostSchema.safeParse({ caption: 'aviso' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.communityId).toBeUndefined();
  });

  it('4. updatePostSchema REFUSES communityId — a published post cannot move (D-72)', () => {
    const parsed = updatePostSchema.safeParse({ caption: 'aviso', communityId: UUID });
    expect(parsed.success, 'the edit body may not carry a destination').toBe(false);
  });
});

describe('D-71 — every post says where it came from', () => {
  it('5. feedPostSchema REQUIRES community, and null is the tenant-wide answer', () => {
    expect(feedPostSchema.safeParse(POST).success).toBe(true);
    const { community: _omitted, ...withoutCommunity } = POST;
    expect(
      feedPostSchema.safeParse(withoutCommunity).success,
      'community is required, never optional',
    ).toBe(false);
  });

  it('6. a community post carries the three-field summary and nothing else', () => {
    const summary = { id: OTHER_UUID, name: 'Avisos da diretoria', slug: 'avisos-da-diretoria' };
    expect(postCommunitySchema.safeParse(summary).success).toBe(true);
    expect(feedPostSchema.safeParse({ ...POST, community: summary }).success).toBe(true);
    // `.strict()`: the label is a NAME and a ROUTE, never a second community card.
    expect(postCommunitySchema.safeParse({ ...summary, postCount: 3 }).success).toBe(false);
  });
});

describe('COMM-04 — `archived` is a machine code in a closed vocabulary', () => {
  it('7. the vocabulary is exactly ["archived"] and the route lookup carries it', () => {
    expect([...FEED_COMMUNITY_ISSUES]).toEqual(['archived']);
    expect(FEED_COMMUNITY_ISSUE_SET.has('archived')).toBe(true);
    expect(FEED_COMMUNITY_ISSUE_SET.has('not_found')).toBe(false);
  });
});

describe('D-73 — the community feed is the same endpoint, not a second contract', () => {
  it('8. feedQuerySchema accepts communityId and still refuses an unknown key', () => {
    const parsed = feedQuerySchema.safeParse({ communityId: UUID });
    expect(parsed.success, 'communityId is an optional query key').toBe(true);
    expect(parsed.success && parsed.data.communityId).toBe(UUID);
    expect(feedQuerySchema.safeParse({ comunidade: UUID }).success).toBe(false);
  });
});
