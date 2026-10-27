import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.3 WR-03 (D-554) — `setProductStatusAction` maps the API's 409 `community_deleted` to its own
 * code so both reactivate surfaces can show their own copy, and every other failure stays generic.
 * The API read, the bootstrap and the cache are stubbed; the action itself is real.
 */

const mocks = vi.hoisted(() => ({
  setProductStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock('@/lib/bootstrap', () => {
  class ApiClientError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      public readonly details?: Record<string, unknown>,
    ) {
      super(`API ${status} ${code}`);
    }
  }
  return {
    ApiClientError,
    bootstrapRedirectPath: (error: { status: number }) => (error.status === 401 ? '/entrar' : null),
  };
});
vi.mock('@/lib/store', () => ({
  createProduct: vi.fn(),
  getProduct: vi.fn(),
  lockPreview: vi.fn(),
  setProductStatus: mocks.setProductStatus,
  updateProduct: vi.fn(),
}));

const { ApiClientError } = await import('@/lib/bootstrap');
const { setProductStatusAction } = await import('./product-actions');

const P = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('setProductStatusAction', () => {
  it('answers ok and revalidates both paths on success', async () => {
    mocks.setProductStatus.mockResolvedValue({});
    expect(await setProductStatusAction(P, 'active')).toEqual({ ok: true });
    expect(mocks.setProductStatus).toHaveBeenCalledWith(P, 'active');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/loja');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('maps a 409 community_deleted to its own code and revalidates nothing', async () => {
    mocks.setProductStatus.mockRejectedValue(
      new ApiClientError(409, 'CONFLICT', { store: 'community_deleted' }),
    );
    expect(await setProductStatusAction(P, 'active')).toEqual({
      ok: false,
      code: 'community_deleted',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps any other 409 generic', async () => {
    mocks.setProductStatus.mockRejectedValue(
      new ApiClientError(409, 'CONFLICT', { store: 'unavailable' }),
    );
    expect(await setProductStatusAction(P, 'active')).toEqual({ ok: false, code: 'generic' });
    mocks.setProductStatus.mockRejectedValue(new ApiClientError(409, 'CONFLICT'));
    expect(await setProductStatusAction(P, 'active')).toEqual({ ok: false, code: 'generic' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps a 404 to not_found', async () => {
    mocks.setProductStatus.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    expect(await setProductStatusAction(P, 'active')).toEqual({ ok: false, code: 'not_found' });
  });

  it('refuses a non-uuid id or a bad status without calling the API', async () => {
    expect(await setProductStatusAction('not-a-uuid', 'active')).toEqual({
      ok: false,
      code: 'generic',
    });
    expect(
      await setProductStatusAction(
        P,
        'deleted' as unknown as Parameters<typeof setProductStatusAction>[1],
      ),
    ).toEqual({ ok: false, code: 'generic' });
    expect(mocks.setProductStatus).not.toHaveBeenCalled();
  });
});
