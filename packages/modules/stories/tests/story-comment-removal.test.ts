import { describe, expect, it } from 'vitest';
import { storyCommentPageSchema, storyCommentSchema } from '../contracts/index';

/**
 * 08-03 (D-336, UI-D-276, MODER-01): the story comment's server-derived `removal`.
 *
 * The web never compares ids to decide who may remove a story comment (T-04-44). The API derives
 * `removal` per viewer — `'own'` for the author, `'moderation'` for a holder of `moderation.manage`
 * on someone else's comment, `null` otherwise — and `canDelete` stays `removal !== null` for the
 * clients that predate the field.
 *
 * The field is OPTIONAL on the strict schema (the 08-01 release-order rule): a Phase 8 web reading a
 * pre-Phase-8 API response must still parse it, and reads the absence as `canDelete ? 'own' : null`.
 * It is NOT open-ended: any other value is refused, so a typo on either side fails loudly.
 *
 * The rendering half (moderation label, no control for `null`, own label) lives beside the host
 * that composes the sheet, `apps/web/components/stories/StoryViewerHost.test.tsx`: the comment rows
 * are the FEED module's shared list, which this package may not import (MOD-02, `turbo boundaries`).
 */

const base = {
  id: '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61',
  createdAt: '2026-10-02T12:00:00.000000Z',
  body: 'Que story bonito.',
  author: {
    membershipId: '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a62',
    displayName: 'Bruno',
    avatarAssetId: null,
  },
  authorRemoved: false,
  canDelete: true,
};

describe('storyCommentSchema.removal (08-03, D-336)', () => {
  it('1. accepts the three server-derived values', () => {
    for (const removal of ['own', 'moderation', null] as const) {
      const parsed = storyCommentSchema.safeParse({
        ...base,
        canDelete: removal !== null,
        removal,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.removal).toBe(removal);
    }
  });

  it('2. a response WITHOUT removal still parses (release-order compatibility)', () => {
    const parsed = storyCommentSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.removal).toBeUndefined();
  });

  it('3. any other value is refused, and the object stays strict', () => {
    expect(storyCommentSchema.safeParse({ ...base, removal: 'admin' }).success).toBe(false);
    expect(storyCommentSchema.safeParse({ ...base, removal: true }).success).toBe(false);
    expect(storyCommentSchema.safeParse({ ...base, deletedBy: 'x' }).success).toBe(false);
  });

  it('4. a page mixes rows with and without the field', () => {
    const parsed = storyCommentPageSchema.safeParse({
      items: [base, { ...base, id: '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a63', removal: 'moderation' }],
      nextCursor: null,
    });
    expect(parsed.success).toBe(true);
  });
});
