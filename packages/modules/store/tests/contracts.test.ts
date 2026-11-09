import { STORE_MAX_PRICE_CENTS } from '@rede-social/contracts/money';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  buyerSchema,
  buyersPageSchema,
  buyersQuerySchema,
  categoriesBodySchema,
  cleanCategoryName,
  communityAccessListSchema,
  communityAccessSchema,
  courseAccessItemSchema,
  courseAccessListSchema,
  courseAccessSchema,
  ENTITLEMENT_SOURCES,
  frontFeaturedBodySchema,
  frontPromoBodySchema,
  GRANT_OUTCOMES,
  grantBodySchema,
  grantResultSchema,
  guessStoreCategory,
  liveAccessItemSchema,
  liveAccessListSchema,
  liveAccessSchema,
  lockPreviewBodySchema,
  lockPreviewSchema,
  newCategoryId,
  PRODUCT_COURSE_STATUSES,
  PRODUCT_FILTERS,
  PRODUCT_LIVE_STATUSES,
  PURCHASE_MODES,
  plainText,
  productCardSchema,
  productCourseSchema,
  productDetailSchema,
  productInputSchema,
  productListQuerySchema,
  productLiveSchema,
  productPageSchema,
  productPatchSchema,
  productStatusBodySchema,
  productUnlockCourseSchema,
  productUnlockLiveSchema,
  purchaseBodySchema,
  purchaseInfoSchema,
  purchaseResultSchema,
  revokeResultSchema,
  STORE_BUILT_IN_CATEGORIES,
  STORE_CATEGORY_ICONS,
  STORE_CATEGORY_MAX,
  STORE_CATEGORY_NAME_MAX,
  STORE_CATEGORY_SLUG_RE,
  STORE_FEATURED_MAX,
  STORE_ISSUE_SET,
  STORE_ISSUES,
  STORE_MAX_CURSOR_LENGTH,
  STORE_MAX_DESCRIPTION,
  STORE_MAX_LINKS,
  STORE_MAX_NAME,
  STORE_MAX_PAGE_SIZE,
  STORE_PAGE_SIZE,
  STORE_PERMISSIONS,
  STORE_PRODUCT_CATEGORIES,
  storeCategorySchema,
  storeFrontSchema,
} from '../contracts/index';
import { GUESS_CORPUS } from './guess-corpus';

const id = (n: number) => `18000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { name: 'Curso', priceCents: 1990 };

/** The machine code a failed parse carries (the route `defaultHook` lifts the first known one). */
function issueOf(input: unknown, schema: z.ZodType = productInputSchema): string | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.map((issue) => issue.message).find((m) => STORE_ISSUE_SET.has(m));
}

describe('store contracts (08.2-01)', () => {
  it('pins the caps, the permission and the issue vocabulary', () => {
    expect(STORE_MAX_NAME).toBe(80);
    expect(STORE_MAX_DESCRIPTION).toBe(2000);
    expect(STORE_MAX_LINKS).toBe(50);
    expect(STORE_PERMISSIONS.manage).toBe('store.product.manage');
    expect(STORE_ISSUES).toContain('price_changed');
    expect(STORE_ISSUES).toContain('unavailable');
    expect(STORE_ISSUES).toContain('community_deleted');
  });

  it('name: 0 after trim fails name_required; 1 and 80 pass; 81 fails name_too_long', () => {
    expect(issueOf({ ...base, name: '' })).toBe('name_required');
    expect(issueOf({ ...base, name: '   ' })).toBe('name_required');
    expect(productInputSchema.parse({ ...base, name: '  a  ' }).name).toBe('a');
    expect(productInputSchema.safeParse({ ...base, name: 'x'.repeat(80) }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, name: ` ${'x'.repeat(80)} ` }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, name: 'x'.repeat(81) })).toBe('name_too_long');
  });

  it('description: defaults to empty; 2000 passes; 2001 fails description_too_long', () => {
    expect(productInputSchema.parse(base).description).toBe('');
    expect(productInputSchema.safeParse({ ...base, description: 'd'.repeat(2000) }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, description: 'd'.repeat(2001) })).toBe('description_too_long');
  });

  it('price goes through priceCentsSchema: -1, 1.5 and cap + 1 fail price_invalid', () => {
    expect(productInputSchema.safeParse({ ...base, priceCents: 0 }).success).toBe(true);
    expect(
      productInputSchema.safeParse({ ...base, priceCents: STORE_MAX_PRICE_CENTS }).success,
    ).toBe(true);
    expect(issueOf({ ...base, priceCents: -1 })).toBe('price_invalid');
    expect(issueOf({ ...base, priceCents: 1.5 })).toBe('price_invalid');
    expect(issueOf({ ...base, priceCents: STORE_MAX_PRICE_CENTS + 1 })).toBe('price_invalid');
    expect(issueOf({ ...base, priceCents: '1990' })).toBe('price_invalid');
    expect(issueOf({ name: 'Curso' })).toBe('price_invalid');
  });

  it('communityIds: 50 pass, 51 fail too_many_communities, duplicates collapse, a non-uuid fails', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => id(i + 1));
    expect(productInputSchema.parse({ ...base, communityIds: fifty }).communityIds).toHaveLength(
      50,
    );
    expect(issueOf({ ...base, communityIds: [...fifty, id(51)] })).toBe('too_many_communities');
    expect(
      productInputSchema.parse({ ...base, communityIds: [id(1), id(2), id(1)] }).communityIds,
    ).toEqual([id(1), id(2)]);
    expect(productInputSchema.parse(base).communityIds).toEqual([]);
    expect(issueOf({ ...base, communityIds: ['nope'] })).toBe('community_invalid');
  });

  it.each([
    ['courseIds', 'course_invalid', 'too_many_courses'],
    ['liveIds', 'live_invalid', 'too_many_lives'],
  ] as const)(
    '%s (08.4): default [], 50 pass, 51 fail %s/%s, duplicates collapse (first kept)',
    (key, invalid, tooMany) => {
      expect(STORE_ISSUES).toContain(invalid);
      expect(STORE_ISSUES).toContain(tooMany);
      const fifty = Array.from({ length: 50 }, (_, i) => id(i + 1));
      expect(productInputSchema.parse(base)[key]).toEqual([]);
      expect(productInputSchema.parse({ ...base, [key]: fifty })[key]).toHaveLength(50);
      expect(issueOf({ ...base, [key]: [...fifty, id(51)] })).toBe(tooMany);
      expect(productInputSchema.parse({ ...base, [key]: [id(2), id(1), id(2)] })[key]).toEqual([
        id(2),
        id(1),
      ]);
      expect(issueOf({ ...base, [key]: ['nope'] })).toBe(invalid);
      // The patch: optional, no default, the same rules; an empty set alone is a valid patch.
      expect(productPatchSchema.parse({ [key]: [] })).toEqual({ [key]: [] });
      expect(productPatchSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
      expect(productPatchSchema.parse({ [key]: [id(1), id(1)] })[key]).toEqual([id(1)]);
      expect(issueOf({ [key]: [...fifty, id(51)] }, productPatchSchema)).toBe(tooMany);
      expect(issueOf({ [key]: ['nope'] }, productPatchSchema)).toBe(invalid);
    },
  );

  it('imageAssetId: null by default, a uuid passes, a non-uuid fails image_invalid', () => {
    expect(productInputSchema.parse(base).imageAssetId).toBeNull();
    expect(productInputSchema.parse({ ...base, imageAssetId: id(9) }).imageAssetId).toBe(id(9));
    expect(issueOf({ ...base, imageAssetId: 'x' })).toBe('image_invalid');
  });

  it('is strict: an unknown key fails (a client-supplied currency or status is refused)', () => {
    expect(productInputSchema.safeParse({ ...base, currency: 'USD' }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, status: 'archived' }).success).toBe(false);
  });

  it('purchaseBodySchema carries only expectedAmountCents, an integer price', () => {
    expect(purchaseBodySchema.safeParse({ expectedAmountCents: 1990 }).success).toBe(true);
    expect(purchaseBodySchema.safeParse({ expectedAmountCents: 0 }).success).toBe(true);
    expect(issueOf({ expectedAmountCents: -1 }, purchaseBodySchema)).toBe('price_invalid');
    expect(issueOf({ expectedAmountCents: 19.9 }, purchaseBodySchema)).toBe('price_invalid');
    expect(issueOf({}, purchaseBodySchema)).toBe('price_invalid');
    expect(
      purchaseBodySchema.safeParse({ expectedAmountCents: 1990, amountCents: 1 }).success,
    ).toBe(false);
  });

  it('purchaseResultSchema answers owned: true only', () => {
    const empty = { communities: [], courses: [], lives: [] };
    expect(purchaseResultSchema.safeParse({ owned: true, ...empty }).success).toBe(true);
    expect(purchaseResultSchema.safeParse({ owned: false, ...empty }).success).toBe(false);
  });
});

describe('store catalogue and access contracts (08.2-05)', () => {
  const card = {
    id: id(1),
    name: 'Curso',
    priceCents: 1990,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
  };

  it('pins the page size, the cap, the cursor cap and the filters', () => {
    expect(STORE_PAGE_SIZE).toBe(20);
    expect(STORE_MAX_PAGE_SIZE).toBe(50);
    expect(STORE_MAX_CURSOR_LENGTH).toBe(512);
    expect(PRODUCT_FILTERS).toEqual(['all', 'owned', 'archived']);
  });

  it('productListQuerySchema: filter defaults to all, limit to 20; bounds and unknown keys are refused', () => {
    expect(productListQuerySchema.parse({})).toEqual({ filter: 'all', limit: 20 });
    expect(productListQuerySchema.parse({ filter: 'owned', limit: '1' })).toEqual({
      filter: 'owned',
      limit: 1,
    });
    expect(productListQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(productListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ filter: 'comprados' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ cursor: 'c'.repeat(512) }).success).toBe(true);
    expect(productListQuerySchema.safeParse({ cursor: 'c'.repeat(513) }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('productCardSchema and productPageSchema are strict', () => {
    expect(productCardSchema.safeParse(card).success).toBe(true);
    expect(productCardSchema.safeParse({ ...card, description: 'x' }).success).toBe(false);
    expect(productPageSchema.safeParse({ items: [card], nextCursor: null }).success).toBe(true);
    expect(productPageSchema.safeParse({ items: [], nextCursor: 'abc' }).success).toBe(true);
    expect(productPageSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success).toBe(
      false,
    );
  });

  it('productDetailSchema: holderCount is optional and a non-negative integer', () => {
    const detail = {
      ...card,
      description: '',
      communities: [],
      unlockedCourses: [],
      unlockedLives: [],
    };
    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: 0 }).success).toBe(true);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: -1 }).success).toBe(false);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: 1.5 }).success).toBe(false);
  });

  it('productDetailSchema (08.4): courses and lives are optional, manager-only, strict rows', () => {
    const detail = {
      ...card,
      description: '',
      communities: [],
      unlockedCourses: [],
      unlockedLives: [],
    };
    expect(PRODUCT_COURSE_STATUSES).toEqual(['draft', 'published']);
    expect(PRODUCT_LIVE_STATUSES).toEqual(['scheduled', 'live', 'recorded']);
    const course = { id: id(4), title: 'Curso', coverAssetId: null, status: 'draft' };
    const live = {
      id: id(5),
      title: 'Live',
      coverAssetId: id(6),
      startsAt: '2026-10-20T19:00:00.000Z',
      status: 'scheduled',
    };
    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      productDetailSchema.safeParse({ ...detail, holderCount: 0, courses: [course], lives: [live] })
        .success,
    ).toBe(true);
    expect(productCourseSchema.safeParse({ ...course, status: 'archived' }).success).toBe(false);
    expect(productCourseSchema.safeParse({ ...course, x: 1 }).success).toBe(false);
    expect(productLiveSchema.safeParse({ ...live, status: 'cancelled' }).success).toBe(false);
    expect(productLiveSchema.safeParse({ ...live, startsAt: 'amanhã' }).success).toBe(false);
  });

  it('communityAccessListSchema and communityAccessSchema are strict; products is optional', () => {
    const item = { communityId: id(2), locked: true, gated: true, archivedTag: false };
    expect(communityAccessListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      communityAccessListSchema.safeParse({ items: [{ ...item, products: [] }] }).success,
    ).toBe(false);
    const access = {
      ...item,
      buyableProducts: [{ id: id(3), name: 'Curso', priceCents: 0, imageAssetId: null }],
    };
    expect(communityAccessSchema.safeParse(access).success).toBe(true);
    expect(
      communityAccessSchema.safeParse({
        ...access,
        products: [{ id: id(3), name: 'Curso', status: 'archived' }],
      }).success,
    ).toBe(true);
    expect(communityAccessSchema.safeParse({ ...access, owned: true }).success).toBe(false);
    expect(
      communityAccessSchema.safeParse({
        ...access,
        buyableProducts: [{ id: id(3), name: 'Curso', priceCents: 0, imageAssetId: null, x: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe('store unlock lists (08.5-05, D-425, STORE-06 / STORE-07 amended)', () => {
  const course = { id: id(9), title: 'Curso', coverAssetId: null };
  const live = {
    id: id(10),
    title: 'Live',
    coverAssetId: id(11),
    startsAt: '2026-10-20T19:00:00.000Z',
  };
  const detail = {
    id: id(1),
    name: 'Curso',
    description: '',
    priceCents: 1990,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
    communities: [],
    unlockedCourses: [course],
    unlockedLives: [live],
  };

  it('productUnlockCourseSchema and productUnlockLiveSchema are strict and carry no status', () => {
    expect(productUnlockCourseSchema.safeParse(course).success).toBe(true);
    expect(productUnlockCourseSchema.safeParse({ ...course, status: 'published' }).success).toBe(
      false,
    );
    expect(productUnlockCourseSchema.safeParse({ ...course, coverAssetId: 'x' }).success).toBe(
      false,
    );
    expect(productUnlockLiveSchema.safeParse(live).success).toBe(true);
    expect(productUnlockLiveSchema.safeParse({ ...live, startsAt: 'amanhã' }).success).toBe(false);
    expect(productUnlockLiveSchema.safeParse({ ...live, externalUrl: 'https://x' }).success).toBe(
      false,
    );
    const { startsAt: _omit, ...withoutStart } = live;
    expect(productUnlockLiveSchema.safeParse(withoutStart).success).toBe(false);
  });

  it('productDetailSchema requires unlockedCourses and unlockedLives for every caller', () => {
    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    const { unlockedCourses: _c, ...noCourses } = detail;
    const { unlockedLives: _l, ...noLives } = detail;
    expect(productDetailSchema.safeParse(noCourses).success).toBe(false);
    expect(productDetailSchema.safeParse(noLives).success).toBe(false);
    expect(
      productDetailSchema.safeParse({ ...detail, unlockedCourses: [{ ...course, x: 1 }] }).success,
    ).toBe(false);
  });

  it('purchaseResultSchema requires courses and lives with the same item shapes', () => {
    const result = { owned: true, communities: [], courses: [course], lives: [live] };
    expect(purchaseResultSchema.safeParse(result).success).toBe(true);
    expect(purchaseResultSchema.safeParse({ owned: true, communities: [] }).success).toBe(false);
    expect(
      purchaseResultSchema.safeParse({ ...result, lives: [{ ...live, startsAt: 'x' }] }).success,
    ).toBe(false);
  });
});

describe('store course and live access contracts (08.5-05, STORE-23)', () => {
  const buyable = { id: id(3), name: 'Curso', priceCents: 0, imageAssetId: null };

  it('courseAccessListSchema and courseAccessSchema are strict; products is optional', () => {
    const item = { courseId: id(7), locked: true, gated: true, archivedTag: false };
    expect(courseAccessListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(courseAccessListSchema.safeParse({ items: [] }).success).toBe(true);
    expect(courseAccessListSchema.safeParse({ items: [{ ...item, products: [] }] }).success).toBe(
      false,
    );
    expect(courseAccessItemSchema.safeParse({ ...item, communityId: id(7) }).success).toBe(false);
    expect(courseAccessItemSchema.safeParse({ ...item, courseId: 'x' }).success).toBe(false);
    const access = { ...item, buyableProducts: [buyable] };
    expect(courseAccessSchema.safeParse(access).success).toBe(true);
    expect(
      courseAccessSchema.safeParse({
        ...access,
        products: [{ id: id(3), name: 'Curso', status: 'archived' }],
      }).success,
    ).toBe(true);
    expect(courseAccessSchema.safeParse({ ...access, liveId: id(7) }).success).toBe(false);
    expect(
      courseAccessSchema.safeParse({ ...access, buyableProducts: [{ ...buyable, x: 1 }] }).success,
    ).toBe(false);
    const { buyableProducts: _omit, ...withoutBuyable } = access;
    expect(courseAccessSchema.safeParse(withoutBuyable).success).toBe(false);
  });

  it('liveAccessListSchema and liveAccessSchema are strict; products is optional', () => {
    const item = { liveId: id(8), locked: false, gated: true, archivedTag: true };
    expect(liveAccessListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(liveAccessListSchema.safeParse({ items: [{ ...item, startsAt: 'x' }] }).success).toBe(
      false,
    );
    expect(liveAccessItemSchema.safeParse({ ...item, courseId: id(8) }).success).toBe(false);
    const access = { ...item, buyableProducts: [] };
    expect(liveAccessSchema.safeParse(access).success).toBe(true);
    expect(
      liveAccessSchema.safeParse({
        ...access,
        products: [{ id: id(3), name: 'Curso', status: 'active' }],
      }).success,
    ).toBe(true);
    expect(
      liveAccessSchema.safeParse({
        ...access,
        products: [{ id: id(3), name: 'Curso', status: 'deleted' }],
      }).success,
    ).toBe(false);
    expect(liveAccessSchema.safeParse({ ...access, owned: true }).success).toBe(false);
  });
});

describe('store admin write contracts (08.2-05)', () => {
  it('productPatchSchema: any subset, at least one key, no defaults, the create rules', () => {
    expect(productPatchSchema.safeParse({}).success).toBe(false);
    expect(productPatchSchema.parse({ name: '  Novo  ' })).toEqual({ name: 'Novo' });
    // No default fills an absent key: a price-only patch never wipes the description or the links.
    expect(productPatchSchema.parse({ priceCents: 4990 })).toEqual({ priceCents: 4990 });
    expect(productPatchSchema.parse({ imageAssetId: null })).toEqual({ imageAssetId: null });
    expect(productPatchSchema.parse({ communityIds: [] })).toEqual({ communityIds: [] });
    expect(productPatchSchema.parse({ communityIds: [id(1), id(1)] }).communityIds).toEqual([
      id(1),
    ]);
    expect(issueOf({ name: '' }, productPatchSchema)).toBe('name_required');
    expect(issueOf({ name: 'x'.repeat(81) }, productPatchSchema)).toBe('name_too_long');
    expect(issueOf({ description: 'd'.repeat(2001) }, productPatchSchema)).toBe(
      'description_too_long',
    );
    expect(issueOf({ priceCents: -1 }, productPatchSchema)).toBe('price_invalid');
    const fiftyOne = Array.from({ length: 51 }, (_, i) => id(i + 1));
    expect(issueOf({ communityIds: fiftyOne }, productPatchSchema)).toBe('too_many_communities');
    expect(productPatchSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(productPatchSchema.safeParse({ currency: 'USD', name: 'x' }).success).toBe(false);
  });

  it('productStatusBodySchema accepts active and archived only, strictly', () => {
    expect(productStatusBodySchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(productStatusBodySchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(productStatusBodySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(productStatusBodySchema.safeParse({}).success).toBe(false);
    expect(productStatusBodySchema.safeParse({ status: 'active', x: 1 }).success).toBe(false);
  });

  it('lockPreviewBodySchema: 1..50 community ids, an optional product id, strict', () => {
    expect(lockPreviewBodySchema.safeParse({ communityIds: [id(1)] }).success).toBe(true);
    expect(
      lockPreviewBodySchema.safeParse({ productId: id(9), communityIds: [id(1)] }).success,
    ).toBe(true);
    expect(lockPreviewBodySchema.safeParse({ communityIds: [] }).success).toBe(false);
    const fifty = Array.from({ length: 50 }, (_, i) => id(i + 1));
    expect(lockPreviewBodySchema.safeParse({ communityIds: fifty }).success).toBe(true);
    expect(issueOf({ communityIds: [...fifty, id(51)] }, lockPreviewBodySchema)).toBe(
      'too_many_communities',
    );
    expect(lockPreviewBodySchema.safeParse({ productId: 'x', communityIds: [id(1)] }).success).toBe(
      false,
    );
    expect(lockPreviewBodySchema.safeParse({ communityIds: [id(1)], x: 1 }).success).toBe(false);
  });

  it('lockPreviewSchema: integer counts from 0, strict rows', () => {
    const row = { communityId: id(1), membersLosingAccess: 0 };
    expect(lockPreviewSchema.safeParse({ items: [row] }).success).toBe(true);
    expect(
      lockPreviewSchema.safeParse({ items: [{ ...row, membersLosingAccess: -1 }] }).success,
    ).toBe(false);
    expect(
      lockPreviewSchema.safeParse({ items: [{ ...row, membersLosingAccess: 1.5 }] }).success,
    ).toBe(false);
    expect(lockPreviewSchema.safeParse({ items: [{ ...row, name: 'x' }] }).success).toBe(false);
  });
});

describe('store buyers, grant and revoke contracts (08.2-06)', () => {
  const buyer = {
    entitlementId: id(1),
    membershipId: id(2),
    displayName: 'Ana',
    avatarAssetId: null,
    source: 'purchase',
    since: '2026-10-08T19:00:00.123456Z',
  };

  it('pins the sources and the grant outcomes', () => {
    expect(ENTITLEMENT_SOURCES).toEqual(['purchase', 'grant']);
    expect(GRANT_OUTCOMES).toEqual(['granted', 'already_active']);
  });

  it('buyersQuerySchema: limit defaults to 20, 1..50 only, cursor capped, strict', () => {
    expect(buyersQuerySchema.parse({})).toEqual({ limit: STORE_PAGE_SIZE });
    expect(buyersQuerySchema.parse({ limit: '50' }).limit).toBe(STORE_MAX_PAGE_SIZE);
    expect(buyersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(buyersQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(
      buyersQuerySchema.safeParse({ cursor: 'x'.repeat(STORE_MAX_CURSOR_LENGTH) }).success,
    ).toBe(true);
    expect(
      buyersQuerySchema.safeParse({ cursor: 'x'.repeat(STORE_MAX_CURSOR_LENGTH + 1) }).success,
    ).toBe(false);
    expect(buyersQuerySchema.safeParse({ filter: 'all' }).success).toBe(false);
  });

  it('buyerSchema: a removed holder carries three nulls; source and since are closed; strict', () => {
    expect(buyerSchema.parse(buyer)).toEqual(buyer);
    const removed = { ...buyer, membershipId: null, displayName: null, source: 'grant' };
    expect(buyerSchema.parse(removed)).toEqual(removed);
    expect(buyerSchema.safeParse({ ...buyer, source: 'gift' }).success).toBe(false);
    expect(buyerSchema.safeParse({ ...buyer, since: 'ontem' }).success).toBe(false);
    expect(buyerSchema.safeParse({ ...buyer, email: 'a@b.c' }).success).toBe(false);
    expect(buyerSchema.safeParse({ ...buyer, userId: id(3) }).success).toBe(false);
  });

  it('buyersPageSchema: total is a non-negative integer; the empty page parses; strict', () => {
    expect(buyersPageSchema.parse({ items: [], nextCursor: null, total: 0 })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(buyersPageSchema.parse({ items: [buyer], nextCursor: 'c', total: 2 }).total).toBe(2);
    expect(buyersPageSchema.safeParse({ items: [], nextCursor: null, total: -1 }).success).toBe(
      false,
    );
    expect(buyersPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
    expect(
      buyersPageSchema.safeParse({ items: [], nextCursor: null, total: 0, more: true }).success,
    ).toBe(false);
  });

  it('grantBodySchema takes one membership uuid, strictly', () => {
    expect(grantBodySchema.parse({ membershipId: id(4) })).toEqual({ membershipId: id(4) });
    expect(grantBodySchema.safeParse({ membershipId: 'x' }).success).toBe(false);
    expect(grantBodySchema.safeParse({}).success).toBe(false);
    expect(grantBodySchema.safeParse({ membershipId: id(4), userId: id(5) }).success).toBe(false);
  });

  it('grantResultSchema answers the two outcomes with an entitlement id; revokeResultSchema only revoked', () => {
    for (const outcome of GRANT_OUTCOMES) {
      expect(grantResultSchema.parse({ outcome, entitlementId: id(6) })).toEqual({
        outcome,
        entitlementId: id(6),
      });
    }
    expect(
      grantResultSchema.safeParse({ outcome: 'forbidden', entitlementId: id(6) }).success,
    ).toBe(false);
    expect(grantResultSchema.safeParse({ outcome: 'granted', entitlementId: null }).success).toBe(
      false,
    );
    expect(revokeResultSchema.parse({ outcome: 'revoked' })).toEqual({ outcome: 'revoked' });
    expect(revokeResultSchema.safeParse({ outcome: 'not_found' }).success).toBe(false);
    expect(revokeResultSchema.safeParse({ outcome: 'revoked', orderId: id(7) }).success).toBe(
      false,
    );
  });
});

describe('store gateway purchase info (09.1-06, D-506, D-508)', () => {
  const card = {
    id: id(1),
    name: 'Curso',
    priceCents: 1990,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
  };
  const detail = {
    ...card,
    description: '',
    communities: [],
    unlockedCourses: [],
    unlockedLives: [],
  };

  it('pins the two modes', () => {
    expect(PURCHASE_MODES).toEqual(['gateway', 'simulated']);
  });

  it('purchaseInfoSchema: a gateway with a link, a simulated one without; any other mode, a non-https link and unknown keys are refused', () => {
    const gateway = { mode: 'gateway', checkoutUrl: 'https://pay.example/x' };
    expect(purchaseInfoSchema.parse(gateway)).toEqual(gateway);
    expect(purchaseInfoSchema.parse({ mode: 'gateway', checkoutUrl: null }).checkoutUrl).toBeNull();
    expect(purchaseInfoSchema.parse({ mode: 'simulated', checkoutUrl: null }).mode).toBe(
      'simulated',
    );
    expect(purchaseInfoSchema.safeParse({ mode: 'other', checkoutUrl: null }).success).toBe(false);
    expect(
      purchaseInfoSchema.safeParse({ mode: 'gateway', checkoutUrl: 'http://pay.example/x' })
        .success,
    ).toBe(false);
    expect(
      purchaseInfoSchema.safeParse({ mode: 'gateway', checkoutUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(purchaseInfoSchema.safeParse({ mode: 'gateway' }).success).toBe(false);
    expect(
      purchaseInfoSchema.safeParse({ mode: 'gateway', checkoutUrl: null, extra: 1 }).success,
    ).toBe(false);
  });

  it('the card and the detail parse with and without the optional purchase key (Pitfall 10)', () => {
    const purchase = { mode: 'gateway', checkoutUrl: 'https://pay.example/x' };
    expect(productCardSchema.safeParse(card).success).toBe(true);
    expect(productCardSchema.parse({ ...card, purchase }).purchase).toEqual(purchase);
    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    expect(productDetailSchema.parse({ ...detail, purchase }).purchase).toEqual(purchase);
    expect(
      productCardSchema.safeParse({ ...card, purchase: { mode: 'other', checkoutUrl: null } })
        .success,
    ).toBe(false);
    expect(
      productDetailSchema.safeParse({
        ...detail,
        purchase: { mode: 'gateway', checkoutUrl: 'http://pay.example/x' },
      }).success,
    ).toBe(false);
  });
});

/**
 * 12.3-11 (NOVF-05..09, D-690, D-693, D-694, D-700, OQ-2, OQ-3): the store front's limits, the moved
 * guess rule pinned to the shared corpus, the slug as the category id and the optional `category` keys.
 */
describe('store categories contract (12.3-11)', () => {
  const card = {
    id: id(1),
    name: 'Curso',
    priceCents: 1990,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
  };

  it('pins the limits, the glyphs and the eight built-ins (D-690, D-691)', () => {
    expect(STORE_CATEGORY_MAX).toBe(20);
    expect(STORE_CATEGORY_NAME_MAX).toBe(30);
    expect(STORE_FEATURED_MAX).toBe(5);
    expect(STORE_CATEGORY_ICONS).toHaveLength(20);
    expect(new Set(STORE_CATEGORY_ICONS).size).toBe(20);
    expect(STORE_BUILT_IN_CATEGORIES.map((category) => category.slug)).toEqual([
      ...STORE_PRODUCT_CATEGORIES,
    ]);
    for (const category of STORE_BUILT_IN_CATEGORIES) {
      expect(STORE_CATEGORY_ICONS).toContain(category.icon);
      expect(STORE_CATEGORY_SLUG_RE.test(category.slug)).toBe(true);
    }
    for (const code of [
      'category_invalid',
      'category_name_required',
      'category_name_too_long',
      'category_name_taken',
      'category_icon_invalid',
      'too_many_categories',
      'promo_invalid',
      'featured_invalid',
      'too_many_featured',
    ]) {
      expect(STORE_ISSUES).toContain(code);
    }
  });

  // One row per case, so a failing row names itself (the corpus is shared with plan 10's pgTAP).
  it.each(GUESS_CORPUS.map(([name, expected]) => ({ name, expected })))(
    'guessStoreCategory parity: $name -> $expected',
    ({ name, expected }) => {
      expect(guessStoreCategory(name)).toBe(expected);
    },
  );

  it('the corpus is the one the SQL twin is pinned to: 68 rows, every slug a built-in', () => {
    expect(GUESS_CORPUS).toHaveLength(68);
    for (const [, expected] of GUESS_CORPUS) {
      expect(STORE_PRODUCT_CATEGORIES as readonly string[]).toContain(expected);
    }
  });

  it('plainText folds accents and case', () => {
    expect(plainText('Fragrância CÍTRICA')).toBe('fragrancia citrica');
  });

  it('the slug pattern accepts livros and a 24-character slug and refuses uppercase, accents, spaces and 25 characters (NOVF-09 encoding)', () => {
    for (const ok of ['livros', 'a', '1', 'livros-2', 'a-b-c', 'a'.repeat(24)]) {
      expect(STORE_CATEGORY_SLUG_RE.test(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'Livros',
      'serviços',
      'a b',
      'a'.repeat(25),
      '-a',
      'a-',
      'a_b',
      'a.b',
      'livros\n',
    ]) {
      expect(STORE_CATEGORY_SLUG_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
    // Adjacency: two different slugs are two different categories, compared by exact equality.
    const [shelf, other]: string[] = ['livros', 'livros-2'];
    expect(
      STORE_CATEGORY_SLUG_RE.test(shelf ?? '') && STORE_CATEGORY_SLUG_RE.test(other ?? ''),
    ).toBe(true);
    expect(shelf === other).toBe(false);
  });

  it('cleanCategoryName trims, folds inner spaces and counts code points', () => {
    expect(cleanCategoryName('   Skin   care \t Cia  ')).toBe('Skin care Cia');
    expect(cleanCategoryName('a'.repeat(31))).toBe('a'.repeat(30));
    // 31 emoji are 62 UTF-16 code units: counted as 31 code points, cut at 30 whole characters.
    expect(Array.from(cleanCategoryName('\u{1F600}'.repeat(31)))).toHaveLength(30);
    expect(cleanCategoryName('   ')).toBe('');
  });

  it('newCategoryId makes a slug unique among the taken set and falls back to "categoria"', () => {
    expect(newCategoryId('Skin care & Cia', new Set())).toBe('skin-care-cia');
    expect(newCategoryId('Livros', new Set(['livros']))).toBe('livros-2');
    expect(newCategoryId('Livros', new Set(['livros', 'livros-2']))).toBe('livros-3');
    expect(newCategoryId('!!!', new Set())).toBe('categoria');
    expect(newCategoryId('!!!', new Set(['categoria']))).toBe('categoria-2');
    expect(newCategoryId('Serviços', new Set())).toBe('servicos');
    const long = newCategoryId('x'.repeat(60), new Set(['x'.repeat(20)]));
    expect(STORE_CATEGORY_SLUG_RE.test(long)).toBe(true);
  });

  it('the create body: an old web body with no category key parses with the key absent; null and a slug parse; the rest is category_invalid', () => {
    const old = productInputSchema.parse(base);
    expect('category' in old).toBe(false);
    expect(productInputSchema.parse({ ...base, category: null }).category).toBeNull();
    expect(productInputSchema.parse({ ...base, category: 'livros' }).category).toBe('livros');
    for (const bad of ['', 'Livros', 'a b', 'serviços', 'a'.repeat(25), 7]) {
      const result = productInputSchema.safeParse({ ...base, category: bad });
      expect(result.success, JSON.stringify(bad)).toBe(false);
    }
    expect(issueOf({ ...base, category: 'Livros' })).toBe('category_invalid');
    expect(issueOf({ ...base, category: '' })).toBe('category_invalid');
  });

  it('the patch body: category alone is a valid patch, null clears, and the strict and non-empty rules stay', () => {
    expect(productPatchSchema.safeParse({ category: null }).success).toBe(true);
    expect(productPatchSchema.safeParse({ category: 'perfumes' }).success).toBe(true);
    expect(productPatchSchema.safeParse({}).success).toBe(false);
    expect(productPatchSchema.safeParse({ category: undefined }).success).toBe(false);
    expect(issueOf({ category: 'Perfumes' }, productPatchSchema)).toBe('category_invalid');
    expect(productPatchSchema.safeParse({ category: 'perfumes', slug: 'x' }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, categoryId: id(1) }).success).toBe(false);
  });

  it('the card and the detail carry the slug as an optional string (OQ-2, D-694); the eight old values stay valid', () => {
    expect('category' in productCardSchema.parse(card)).toBe(false);
    for (const slug of [...STORE_PRODUCT_CATEGORIES, 'skin-care', 'livros-2']) {
      expect(productCardSchema.parse({ ...card, category: slug }).category).toBe(slug);
    }
    expect(productCardSchema.safeParse({ ...card, category: 'Livros' }).success).toBe(false);
    expect(productCardSchema.safeParse({ ...card, category: '' }).success).toBe(false);
    expect(productCardSchema.safeParse({ ...card, category: null }).success).toBe(false);
  });

  it('storeFrontSchema and storeCategorySchema are strict; the empty store front parses', () => {
    const category = { id: 'livros', name: 'Livros', icon: 'book-open' };
    expect(storeCategorySchema.safeParse(category).success).toBe(true);
    expect(storeCategorySchema.safeParse({ ...category, icon: 'rocket' }).success).toBe(false);
    expect(storeCategorySchema.safeParse({ ...category, id: 'Livros' }).success).toBe(false);
    expect(storeCategorySchema.safeParse({ ...category, position: 1 }).success).toBe(false);
    const front = { categories: [category], promoProductId: id(2), featuredProductIds: [id(3)] };
    expect(storeFrontSchema.safeParse(front).success).toBe(true);
    expect(
      storeFrontSchema.safeParse({ categories: [], promoProductId: null, featuredProductIds: [] })
        .success,
    ).toBe(true);
    expect(storeFrontSchema.safeParse({ ...front, extra: 1 }).success).toBe(false);
    expect(
      storeFrontSchema.safeParse({
        ...front,
        featuredProductIds: [id(1), id(2), id(3), id(4), id(5), id(6)],
      }).success,
    ).toBe(false);
  });
});

describe('the front write bodies (12.3-12, D-696, D-699, OQ-4)', () => {
  it('the promo body is strict: a uuid or null, nothing else', () => {
    expect(frontPromoBodySchema.safeParse({ productId: id(1) }).success).toBe(true);
    expect(frontPromoBodySchema.safeParse({ productId: null }).success).toBe(true);
    expect(frontPromoBodySchema.safeParse({}).success).toBe(false);
    expect(frontPromoBodySchema.safeParse({ productId: 'x' }).success).toBe(false);
    expect(frontPromoBodySchema.safeParse({ productId: id(1), tenantId: id(2) }).success).toBe(
      false,
    );
  });

  it('the featured body is strict and leaves the five-product refusal to the service (a schema cap of 100)', () => {
    expect(frontFeaturedBodySchema.safeParse({ productIds: [] }).success).toBe(true);
    expect(frontFeaturedBodySchema.safeParse({ productIds: [id(1), id(2)] }).success).toBe(true);
    // Six passes the schema on purpose: `too_many_featured` is the service's code, not a generic issue.
    const six = Array.from({ length: STORE_FEATURED_MAX + 1 }, (_, n) => id(n + 1));
    expect(frontFeaturedBodySchema.safeParse({ productIds: six }).success).toBe(true);
    const huge = Array.from({ length: 101 }, (_, n) => id(n + 1));
    expect(frontFeaturedBodySchema.safeParse({ productIds: huge }).success).toBe(false);
    expect(frontFeaturedBodySchema.safeParse({}).success).toBe(false);
    expect(frontFeaturedBodySchema.safeParse({ productIds: ['x'] }).success).toBe(false);
    expect(frontFeaturedBodySchema.safeParse({ productIds: [], extra: 1 }).success).toBe(false);
  });

  it('the categories body: an optional slug id, a name and an icon, strict; the 20-category and name limits are the service’s', () => {
    const entry = { name: 'Livros', icon: 'book-open' };
    expect(categoriesBodySchema.safeParse({ categories: [] }).success).toBe(true);
    expect(categoriesBodySchema.safeParse({ categories: [entry] }).success).toBe(true);
    expect(
      categoriesBodySchema.safeParse({ categories: [{ ...entry, id: 'livros' }] }).success,
    ).toBe(true);
    // 21 passes the schema (the service answers too_many_categories); the cap of 50 is the schema's.
    const many = (n: number) => Array.from({ length: n }, (_, k) => ({ ...entry, name: `C${k}` }));
    expect(many(STORE_CATEGORY_MAX + 1)).toHaveLength(21);
    expect(
      categoriesBodySchema.safeParse({ categories: many(STORE_CATEGORY_MAX + 1) }).success,
    ).toBe(true);
    expect(categoriesBodySchema.safeParse({ categories: many(51) }).success).toBe(false);
    // A name over 30 and an unknown icon pass the schema too: their codes are the service's.
    expect(
      categoriesBodySchema.safeParse({
        categories: [{ name: 'x'.repeat(STORE_CATEGORY_NAME_MAX + 1), icon: 'rocket' }],
      }).success,
    ).toBe(true);
    // Mass assignment: a position, a tenant id or an unknown key is refused; a bad id is category_invalid.
    expect(
      categoriesBodySchema.safeParse({ categories: [{ ...entry, position: 1 }] }).success,
    ).toBe(false);
    expect(categoriesBodySchema.safeParse({ categories: [], tenantId: id(1) }).success).toBe(false);
    expect(categoriesBodySchema.safeParse({}).success).toBe(false);
    expect(issueOf({ categories: [{ ...entry, id: 'Livros' }] }, categoriesBodySchema)).toBe(
      'category_invalid',
    );
    expect(issueOf({ categories: [{ ...entry, id: '' }] }, categoriesBodySchema)).toBe(
      'category_invalid',
    );
    expect(
      issueOf({ categories: [{ name: 'x'.repeat(201), icon: 'tag' }] }, categoriesBodySchema),
    ).toBe('category_name_too_long');
  });
});
