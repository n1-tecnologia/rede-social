import {
  type ProductCommunityLink,
  productInputSchema,
  productPatchSchema,
} from '@rede-social/module-store/contracts';
import { describe, expect, it } from 'vitest';
import {
  type BuyerPermissions,
  defaultPermissions,
  originalLinks,
  PERMISSION_ORDER,
  toProductLinksBody,
} from '@/lib/store-permissions';

/**
 * 11.1-10 task 1 (the tracer): a form selection becomes a body the REAL contract of plan 05 accepts.
 * The schemas are the real ones from `@rede-social/module-store/contracts`; nothing is mocked.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const link = (communityId: string, over: Partial<BuyerPermissions> = {}): ProductCommunityLink => ({
  communityId,
  ...defaultPermissions(),
  ...over,
});

describe('PERMISSION_ORDER and defaultPermissions (D-890, UI-D-883)', () => {
  it('pins the checkbox order: like, comment, share, post, story', () => {
    expect([...PERMISSION_ORDER]).toEqual(['like', 'comment', 'share', 'post', 'story']);
  });

  it('defaults to like, comment and share on, post and story off, as a fresh object each time', () => {
    expect(defaultPermissions()).toEqual({
      like: true,
      comment: true,
      share: true,
      post: false,
      story: false,
    });
    expect(defaultPermissions()).not.toBe(defaultPermissions());
  });
});

describe('toProductLinksBody (D-890, D-891)', () => {
  it('TRACER: an existing link with a stored non-default kept as is yields communityIds; ticking story yields all five booleans, and both parse', () => {
    const original = new Map([[A, { ...defaultPermissions(), post: true }]]);

    const untouched = toProductLinksBody([link(A, { post: true })], original);
    expect(untouched).toEqual({ communityIds: [A] });
    expect(productPatchSchema.safeParse(untouched).success).toBe(true);

    const withStory = toProductLinksBody([link(A, { post: true, story: true })], original);
    expect(withStory).toEqual({
      communityLinks: [
        { communityId: A, like: true, comment: true, share: true, post: true, story: true },
      ],
    });
    const patch = productPatchSchema.safeParse(withStory);
    expect(patch.success).toBe(true);
    const create = productInputSchema.safeParse({ name: 'Curso', priceCents: 1990, ...withStory });
    expect(create.success).toBe(true);
    if (create.success) {
      expect(create.data.communityLinks).toEqual([
        { communityId: A, like: true, comment: true, share: true, post: true, story: true },
      ]);
      expect(create.data.communityIds).toEqual([]);
    }
  });

  it('a stored non-default link ticked back to the defaults is sent as communityLinks (a communityIds save would keep the stored flags)', () => {
    const original = new Map([[A, { ...defaultPermissions(), story: true }]]);
    const body = toProductLinksBody([link(A)], original);
    expect(body).toEqual({
      communityLinks: [
        { communityId: A, like: true, comment: true, share: true, post: false, story: false },
      ],
    });
    expect(productPatchSchema.safeParse(body).success).toBe(true);
  });

  it('a new link at the defaults yields communityIds; a new link with post ticked yields communityLinks', () => {
    const atDefaults = toProductLinksBody([link(A)], new Map());
    expect(atDefaults).toEqual({ communityIds: [A] });
    expect(productPatchSchema.safeParse(atDefaults).success).toBe(true);

    const withPost = toProductLinksBody([link(A), link(B, { post: true })], new Map());
    expect(withPost).toEqual({
      communityLinks: [
        { communityId: A, like: true, comment: true, share: true, post: false, story: false },
        { communityId: B, like: true, comment: true, share: true, post: true, story: false },
      ],
    });
    expect(productPatchSchema.safeParse(withPost).success).toBe(true);
  });

  it('keeps the selected order in communityIds, and an empty selection is an empty communityIds', () => {
    expect(toProductLinksBody([link(B), link(A)], new Map())).toEqual({ communityIds: [B, A] });
    expect(toProductLinksBody([], new Map())).toEqual({ communityIds: [] });
  });

  it('never leaks a key beyond the six the strict link schema allows', () => {
    const noisy = { ...link(A, { story: true }), openHighlights: 3 } as ProductCommunityLink;
    const body = toProductLinksBody([noisy], new Map());
    expect(productPatchSchema.safeParse(body).success).toBe(true);
  });
});

describe('originalLinks', () => {
  it('maps every existing community to its stored flags, else the defaults', () => {
    const stored = {
      communityId: B,
      like: false,
      comment: true,
      share: true,
      post: true,
      story: false,
    };
    const map = originalLinks([A, B], [stored]);
    expect(map.get(A)).toEqual(defaultPermissions());
    expect(map.get(B)).toEqual({
      like: false,
      comment: true,
      share: true,
      post: true,
      story: false,
    });
    expect(originalLinks([A], undefined).get(A)).toEqual(defaultPermissions());
  });
});
