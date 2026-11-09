import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { getStoreFront, saveStoreCategories, setStoreFeatured, setStorePromo } from './store';

/**
 * 12.3-13 (D-696, D-699, UI-D-690): the storefront's one read and the two setup saves.
 *
 *  - `getStoreFront` answers the front, ignores a key the API adds later, and is `null` on ANY failure
 *    (never throws), so the storefront degrades to the products alone.
 *  - `setStoreFeatured` and `saveStoreCategories` map the API's closed `details.store` refusals to an
 *    `issue`, a navigation the bootstrap knows to `redirect`, and anything else to `error`; they
 *    never throw. Their bodies are exactly what the contract allows (a new category carries no id).
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function refusal(status: number, code: string, details?: Record<string, unknown>): Response {
  return json(
    { error: { code, message: code, requestId: 'r', ...(details ? { details } : {}) } },
    status,
  );
}

const FRONT = {
  categories: [{ id: 'livros', name: 'Livros', icon: 'book-open' }],
  promoProductId: null,
  featuredProductIds: [P1],
};

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getStoreFront', () => {
  it('answers the store front from the one call', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(FRONT));
    expect(await getStoreFront()).toEqual(FRONT);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/store/front');
  });

  it('ignores a key the API adds later, on the front or on a category', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json({
        ...FRONT,
        banner: 'later',
        categories: [{ ...FRONT.categories[0], color: 'red' }],
      }),
    );
    expect(await getStoreFront()).toEqual(FRONT);
  });

  it('is null on a refusal, a 5xx, a body that does not parse and a transport failure', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
    expect(await getStoreFront()).toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(json({}, 500));
    expect(await getStoreFront()).toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(json({ categories: 'x' }));
    expect(await getStoreFront()).toBeNull();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    expect(await getStoreFront()).toBeNull();
  });

  it('the store off is null too, without a log line', async () => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await getStoreFront()).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('setStoreFeatured', () => {
  it('PUTs the ordered ids and answers the fresh front', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(FRONT));
    expect(await setStoreFeatured([P2, P1])).toEqual({ status: 'ok', front: FRONT });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/store/front/featured');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ productIds: [P2, P1] });
  });

  it('an empty list is a valid body ("Usar os mais recentes")', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ ...FRONT, featuredProductIds: [] }));
    await setStoreFeatured([]);
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0]?.[1]?.body))).toEqual({
      productIds: [],
    });
  });

  it('maps the closed refusals to an issue', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      refusal(400, 'VALIDATION_ERROR', { store: 'featured_invalid' }),
    );
    expect(await setStoreFeatured([P1])).toEqual({ status: 'issue', issue: 'featured_invalid' });
    vi.mocked(apiFetch).mockResolvedValueOnce(
      refusal(400, 'VALIDATION_ERROR', { store: 'too_many_featured' }),
    );
    expect(await setStoreFeatured([P1])).toEqual({ status: 'issue', issue: 'too_many_featured' });
  });

  it('anything else is an error, and a thrown fetch never escapes', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json({}, 500));
    expect(await setStoreFeatured([P1])).toEqual({ status: 'error' });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    expect(await setStoreFeatured([P1])).toEqual({ status: 'error' });
  });
});

describe('saveStoreCategories', () => {
  it('PUTs the whole ordered list: a kept row with its id, a new row with none', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(FRONT));
    const list = [
      { id: 'livros', name: 'Livros', icon: 'book-open' },
      { name: 'Skincare', icon: 'tag' },
    ];
    expect(await saveStoreCategories(list)).toEqual({ status: 'ok', front: FRONT });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/store/categories');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ categories: list });
  });

  it('maps every coded refusal, the stale one included, to an issue', async () => {
    for (const code of [
      'category_invalid',
      'category_name_required',
      'category_name_too_long',
      'category_name_taken',
      'category_icon_invalid',
      'too_many_categories',
    ] as const) {
      vi.mocked(apiFetch).mockResolvedValueOnce(refusal(400, 'VALIDATION_ERROR', { store: code }));
      expect(await saveStoreCategories([{ name: 'x', icon: 'tag' }])).toEqual({
        status: 'issue',
        issue: code,
      });
    }
  });

  it('a 401 the bootstrap knows is a navigation; a plain failure is an error', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(refusal(401, 'UNAUTHENTICATED'));
    expect(await saveStoreCategories([{ name: 'x', icon: 'tag' }])).toEqual({
      status: 'redirect',
      path: '/entrar',
    });
    vi.mocked(apiFetch).mockResolvedValueOnce(json({}, 500));
    expect(await saveStoreCategories([{ name: 'x', icon: 'tag' }])).toEqual({ status: 'error' });
  });
});

describe('setStorePromo', () => {
  it('PUTs the chosen product id and answers the fresh front', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ ...FRONT, promoProductId: P2 }));
    expect(await setStorePromo(P2)).toEqual({
      status: 'ok',
      front: { ...FRONT, promoProductId: P2 },
    });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/store/front/promo');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ productId: P2 });
  });

  it('null clears the promotion ("Mais recente da loja")', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(FRONT));
    await setStorePromo(null);
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0]?.[1]?.body))).toEqual({
      productId: null,
    });
  });

  it('maps promo_invalid to an issue; anything else is an error and a thrown fetch never escapes', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      refusal(400, 'VALIDATION_ERROR', { store: 'promo_invalid' }),
    );
    expect(await setStorePromo(P1)).toEqual({ status: 'issue', issue: 'promo_invalid' });
    vi.mocked(apiFetch).mockResolvedValue(refusal(500, 'INTERNAL'));
    expect(await setStorePromo(P1)).toEqual({ status: 'error' });
    vi.mocked(apiFetch).mockRejectedValue(new Error('network'));
    expect(await setStorePromo(P1)).toEqual({ status: 'error' });
  });
});
