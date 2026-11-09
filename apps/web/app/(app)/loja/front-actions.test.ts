import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-13 (D-690, D-691, D-699): the two store-setup saves, as server actions. A server action is a
 * public endpoint, so the SAME Zod the API validates with runs BEFORE the request; a refusal is a CODE
 * the sheet maps to copy (`StoreIssue` or `generic`), a navigation the bootstrap knows runs OUTSIDE any
 * try/catch (Next 16: `redirect()` throws), and a save revalidates the store screens.
 */

const mocks = vi.hoisted(() => ({
  setStoreFeatured: vi.fn(),
  saveStoreCategories: vi.fn(),
  setStorePromo: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock('@/lib/store', () => ({
  getProducts: vi.fn(),
  purchaseProduct: vi.fn(),
  setStoreFeatured: mocks.setStoreFeatured,
  saveStoreCategories: mocks.saveStoreCategories,
  setStorePromo: mocks.setStorePromo,
}));
vi.mock('@/lib/store-revalidate', () => ({ revalidateStoreScreens: mocks.revalidate }));
vi.mock('@/lib/bootstrap', () => ({
  ApiClientError: class ApiClientError extends Error {},
  bootstrapRedirectPath: () => null,
  requireBootstrap: vi.fn(),
}));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));

const { saveStoreCategoriesAction, setStoreFeaturedAction, setStorePromoAction } = await import(
  './actions'
);

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const FRONT = { categories: [], promoProductId: null, featuredProductIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setStoreFeaturedAction', () => {
  it('sends the ordered ids, answers ok and revalidates the store screens', async () => {
    mocks.setStoreFeatured.mockResolvedValue({ status: 'ok', front: FRONT });
    expect(await setStoreFeaturedAction([P2, P1])).toEqual({ ok: true });
    expect(mocks.setStoreFeatured).toHaveBeenCalledWith([P2, P1]);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  it('an empty list is valid ("Usar os mais recentes")', async () => {
    mocks.setStoreFeatured.mockResolvedValue({ status: 'ok', front: FRONT });
    expect(await setStoreFeaturedAction([])).toEqual({ ok: true });
    expect(mocks.setStoreFeatured).toHaveBeenCalledWith([]);
  });

  it('refuses a malformed body before any request: not a list, not uuids, a forged key', async () => {
    for (const bad of ['x', null, [123], ['not-a-uuid'], Array.from({ length: 101 }, () => P1)]) {
      expect(await setStoreFeaturedAction(bad)).toEqual({ ok: false, code: 'generic' });
    }
    expect(mocks.setStoreFeatured).not.toHaveBeenCalled();
  });

  it("answers the API's closed refusals as codes and does not revalidate", async () => {
    mocks.setStoreFeatured.mockResolvedValue({ status: 'issue', issue: 'featured_invalid' });
    expect(await setStoreFeaturedAction([P1])).toEqual({ ok: false, code: 'featured_invalid' });
    mocks.setStoreFeatured.mockResolvedValue({ status: 'issue', issue: 'too_many_featured' });
    expect(await setStoreFeaturedAction([P1])).toEqual({ ok: false, code: 'too_many_featured' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('a transport failure or the store off is the generic code', async () => {
    mocks.setStoreFeatured.mockResolvedValue({ status: 'error' });
    expect(await setStoreFeaturedAction([P1])).toEqual({ ok: false, code: 'generic' });
    mocks.setStoreFeatured.mockResolvedValue({ status: 'disabled' });
    expect(await setStoreFeaturedAction([P1])).toEqual({ ok: false, code: 'generic' });
  });

  it('a navigation the bootstrap knows redirects instead of answering', async () => {
    mocks.setStoreFeatured.mockResolvedValue({ status: 'redirect', path: '/entrar' });
    await expect(setStoreFeaturedAction([P1])).rejects.toThrow('REDIRECT /entrar');
  });
});

describe('saveStoreCategoriesAction', () => {
  const LIST = [
    { id: 'livros', name: 'Livros', icon: 'book-open' },
    { name: 'Skincare', icon: 'tag' },
  ];

  it('sends the whole ordered list: a kept row with its id, a new row with none', async () => {
    mocks.saveStoreCategories.mockResolvedValue({ status: 'ok', front: FRONT });
    expect(await saveStoreCategoriesAction(LIST)).toEqual({ ok: true });
    expect(mocks.saveStoreCategories).toHaveBeenCalledWith(LIST);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed body before any request: a forged key, a bad slug, no list', async () => {
    for (const bad of [
      null,
      'x',
      [{ name: 'x', icon: 'tag', position: 1 }],
      [{ id: 'Not A Slug', name: 'x', icon: 'tag' }],
      [{ name: 'x' }],
      Array.from({ length: 51 }, () => ({ name: 'x', icon: 'tag' })),
    ]) {
      const result = await saveStoreCategoriesAction(bad);
      expect(result.ok).toBe(false);
    }
    expect(mocks.saveStoreCategories).not.toHaveBeenCalled();
  });

  it("answers the API's closed refusals as codes, the stale one included", async () => {
    for (const code of [
      'category_invalid',
      'category_name_required',
      'category_name_too_long',
      'category_name_taken',
      'category_icon_invalid',
      'too_many_categories',
    ]) {
      mocks.saveStoreCategories.mockResolvedValue({ status: 'issue', issue: code });
      expect(await saveStoreCategoriesAction(LIST)).toEqual({ ok: false, code });
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('a transport failure is the generic code; a known navigation redirects', async () => {
    mocks.saveStoreCategories.mockResolvedValue({ status: 'error' });
    expect(await saveStoreCategoriesAction(LIST)).toEqual({ ok: false, code: 'generic' });
    mocks.saveStoreCategories.mockResolvedValue({ status: 'redirect', path: '/entrar' });
    await expect(saveStoreCategoriesAction(LIST)).rejects.toThrow('REDIRECT /entrar');
  });
});

describe('setStorePromoAction (12.3-14, D-699)', () => {
  it('sends the product id, answers ok and revalidates the store screens', async () => {
    mocks.setStorePromo.mockResolvedValue({ status: 'ok', front: FRONT });
    expect(await setStorePromoAction(P1)).toEqual({ ok: true });
    expect(mocks.setStorePromo).toHaveBeenCalledWith(P1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  it('null is valid ("Mais recente da loja")', async () => {
    mocks.setStorePromo.mockResolvedValue({ status: 'ok', front: FRONT });
    expect(await setStorePromoAction(null)).toEqual({ ok: true });
    expect(mocks.setStorePromo).toHaveBeenCalledWith(null);
  });

  it('refuses a malformed body before any request: not a uuid, not a string, undefined', async () => {
    for (const bad of ['not-a-uuid', 123, undefined, {}, [P1]]) {
      expect(await setStorePromoAction(bad)).toEqual({ ok: false, code: 'generic' });
    }
    expect(mocks.setStorePromo).not.toHaveBeenCalled();
  });

  it("answers the API's refusal as a code and a failure as generic, never revalidating", async () => {
    mocks.setStorePromo.mockResolvedValue({ status: 'issue', issue: 'promo_invalid' });
    expect(await setStorePromoAction(P1)).toEqual({ ok: false, code: 'promo_invalid' });
    mocks.setStorePromo.mockResolvedValue({ status: 'error' });
    expect(await setStorePromoAction(P1)).toEqual({ ok: false, code: 'generic' });
    mocks.setStorePromo.mockResolvedValue({ status: 'disabled' });
    expect(await setStorePromoAction(P1)).toEqual({ ok: false, code: 'generic' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('a navigation the bootstrap knows redirects outside any try/catch', async () => {
    mocks.setStorePromo.mockResolvedValue({ status: 'redirect', path: '/entrar' });
    await expect(setStorePromoAction(P1)).rejects.toThrow('REDIRECT /entrar');
  });
});
