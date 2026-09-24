import { describe, expect, it } from 'vitest';
import {
  createStoryCommentSchema,
  STORY_COMMENT_ISSUE_SET,
  STORY_COMMENT_ISSUES,
  STORY_COMMENTS_MAX_PAGE_SIZE,
  STORY_COMMENTS_PAGE_SIZE,
  STORY_MAX_COMMENT,
  storyCommentPageSchema,
  storyCommentSchema,
  storyCommentsQuerySchema,
} from '../contracts/index';

/**
 * STORY-05's contract surface, and the ONE rule it exists to NOT enforce.
 *
 * The roadmap states twice that a story comment cannot be liked or replied to. The whole point of
 * 05-07 is that the DATABASE is the arbiter of that: a stored generated `target_kind`, a
 * three-column composite self-foreign-key and a null-guarded shape CHECK make the row
 * unrepresentable. The API's 400 is a TRANSLATION of the SQLSTATE and the missing button is UX.
 *
 * Which means this schema must deliberately ACCEPT a `parentId`. A `.strict()` object without one
 * would move the refusal back into the application layer — the exact failure mode the plan names:
 * "an application check passes its own tests while the constraint is missing". A member who calls
 * the API directly must get the same answer as a member tapping a button, and that answer must come
 * from Postgres.
 *
 * The rest of the file is the ordinary contract posture: a closed refusal vocabulary of MACHINE
 * codes (no pt-BR ever crosses this boundary), UTF-16 code units at both ends of the length cap,
 * `.strict()` queries, and the removed-author shape (UI-D-24) carried verbatim from the feed —
 * because a story comment whose author left the tenant keeps its row, its text and its timestamp.
 */

const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';

describe('createStoryCommentSchema — the schema is NOT the thing that refuses a reply (STORY-05)', () => {
  it('1. it ACCEPTS a parentId, so the DATABASE is what refuses a reply to a story comment', () => {
    const parsed = createStoryCommentSchema.safeParse({ body: 'oi', parentId: UUID });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.parentId).toBe(UUID);
  });

  it('2. a root comment needs no parentId at all', () => {
    const parsed = createStoryCommentSchema.safeParse({ body: 'oi' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.parentId).toBeUndefined();
  });

  it('3. an empty or whitespace-only body is refused, and the cap is UTF-16 code units', () => {
    expect(createStoryCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(
      createStoryCommentSchema.safeParse({ body: 'a'.repeat(STORY_MAX_COMMENT) }).success,
    ).toBe(true);
    expect(
      createStoryCommentSchema.safeParse({ body: 'a'.repeat(STORY_MAX_COMMENT + 1) }).success,
    ).toBe(false);
  });

  it('4. an unknown key fails loudly — `.strict()`, the 03-03 rule', () => {
    expect(createStoryCommentSchema.safeParse({ body: 'oi', depth: 1 }).success).toBe(false);
  });
});

describe('the closed refusal vocabulary — two codes, because two different refusals', () => {
  it('5. both STORY-05 refusals have their OWN machine code', () => {
    expect([...STORY_COMMENT_ISSUES].sort()).toEqual([
      'story_comment_no_reply',
      'story_comment_not_likeable',
    ]);
  });

  it('6. the set is the lookup the route hook and the web tier share', () => {
    expect(STORY_COMMENT_ISSUE_SET.has('story_comment_no_reply')).toBe(true);
    expect(STORY_COMMENT_ISSUE_SET.has('story_comment_not_likeable')).toBe(true);
    expect(STORY_COMMENT_ISSUE_SET.has('reply_depth_exceeded')).toBe(false);
  });

  it('7. every code is a MACHINE code — no pt-BR crosses this boundary (PWA-03)', () => {
    for (const code of STORY_COMMENT_ISSUES) expect(code).toMatch(/^[a-z][a-z_]*$/);
  });
});

describe('storyCommentsQuerySchema — one bounded page, refused above the cap', () => {
  it('8. it defaults to the page size and refuses a limit above the maximum', () => {
    const parsed = storyCommentsQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.limit).toBe(STORY_COMMENTS_PAGE_SIZE);
    expect(
      storyCommentsQuerySchema.safeParse({ limit: String(STORY_COMMENTS_MAX_PAGE_SIZE) }).success,
    ).toBe(true);
    expect(
      storyCommentsQuerySchema.safeParse({ limit: String(STORY_COMMENTS_MAX_PAGE_SIZE + 1) })
        .success,
    ).toBe(false);
  });

  it('9. an unknown query key fails loudly', () => {
    expect(storyCommentsQuerySchema.safeParse({ order: 'desc' }).success).toBe(false);
  });
});

describe('storyCommentSchema — the removed author keeps the row (UI-D-24)', () => {
  const row = {
    id: UUID,
    createdAt: '2026-09-24T00:00:00.000001Z',
    body: 'oi',
    author: { membershipId: null, displayName: null, avatarAssetId: null },
    authorRemoved: true,
    canDelete: false,
  };

  it('10. all three identifying author fields are nullable together', () => {
    expect(storyCommentSchema.safeParse(row).success).toBe(true);
  });

  it('11. it carries NO likeCount, NO viewerLiked and NO replyCount — a flat list has none', () => {
    expect(storyCommentSchema.safeParse({ ...row, likeCount: 0 }).success).toBe(false);
    expect(storyCommentSchema.safeParse({ ...row, replyCount: 0 }).success).toBe(false);
  });

  it('12. a page is items plus a nullable cursor, and nothing else', () => {
    expect(storyCommentPageSchema.safeParse({ items: [row], nextCursor: null }).success).toBe(true);
    expect(
      storyCommentPageSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success,
    ).toBe(false);
  });
});
