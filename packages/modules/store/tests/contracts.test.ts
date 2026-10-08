import { STORE_MAX_PRICE_CENTS } from '@rede-social/contracts/money';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  communityAccessListSchema,
  communityAccessSchema,
  lockPreviewBodySchema,
  lockPreviewSchema,
  PRODUCT_FILTERS,
  productCardSchema,
  productDetailSchema,
  productInputSchema,
  productListQuerySchema,
  productPageSchema,
  productPatchSchema,
  productStatusBodySchema,
  purchaseBodySchema,
  purchaseResultSchema,
  STORE_ISSUE_SET,
  STORE_ISSUES,
  STORE_MAX_CURSOR_LENGTH,
  STORE_MAX_DESCRIPTION,
  STORE_MAX_LINKS,
  STORE_MAX_NAME,
  STORE_MAX_PAGE_SIZE,
  STORE_PAGE_SIZE,
  STORE_PERMISSIONS,
} from '../contracts/index';

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
    expect(purchaseResultSchema.safeParse({ owned: true, communities: [] }).success).toBe(true);
    expect(purchaseResultSchema.safeParse({ owned: false, communities: [] }).success).toBe(false);
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
    const detail = { ...card, description: '', communities: [] };
    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: 0 }).success).toBe(true);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: -1 }).success).toBe(false);
    expect(productDetailSchema.safeParse({ ...detail, holderCount: 1.5 }).success).toBe(false);
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
