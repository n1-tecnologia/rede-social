import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-17 (PAY-20, D-502, A-P12, T-09.1-80) — `savePaymentMappingAction`: the second call of the product
 * form's two-step save. The SAME Zod the API validates with runs BEFORE any request, both fields empty
 * is a delete, anything else is a put, and a refusal the bootstrap knows navigates outside any
 * try/catch (Next 16: `redirect()` throws). The payments web client is stubbed; the schemas are real.
 */

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/payments', () => ({
  putStoreMapping: mocks.put,
  deleteStoreMapping: mocks.del,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { savePaymentMappingAction } = await import('./payment-actions');

const P = '11111111-1111-4111-8111-111111111111';
const OK = { ok: true, connected: true, mapping: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.put.mockResolvedValue(OK);
  mocks.del.mockResolvedValue(OK);
});

describe('savePaymentMappingAction', () => {
  it('both fields empty (or blanks) clears the mapping with a DELETE', async () => {
    expect(await savePaymentMappingAction(P, { externalProductId: '  ', checkoutUrl: '' })).toEqual(
      {
        ok: true,
      },
    );
    expect(mocks.del).toHaveBeenCalledWith(P);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('an ID without a link is a PUT with no link key', async () => {
    await savePaymentMappingAction(P, { externalProductId: ' a1b2 ', checkoutUrl: '' });
    expect(mocks.put).toHaveBeenCalledWith(P, { externalProductId: 'a1b2' });
  });

  it('an ID with a link is a PUT with both, trimmed', async () => {
    await savePaymentMappingAction(P, {
      externalProductId: 'a1b2',
      checkoutUrl: ' https://pay.example/a1b2 ',
    });
    expect(mocks.put).toHaveBeenCalledWith(P, {
      externalProductId: 'a1b2',
      checkoutUrl: 'https://pay.example/a1b2',
    });
  });

  it('a link without an ID is refused before any request', async () => {
    expect(
      await savePaymentMappingAction(P, {
        externalProductId: '',
        checkoutUrl: 'https://pay.example/a1b2',
      }),
    ).toEqual({ ok: false, issue: 'id_required' });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it.each([
    'http://pay.example/x',
    'javascript:alert(1)',
    'pay.example/x',
    'https://u:p@pay.example/x',
  ])('a link %s is refused before any request', async (checkoutUrl) => {
    expect(await savePaymentMappingAction(P, { externalProductId: 'a1', checkoutUrl })).toEqual({
      ok: false,
      issue: 'link_invalid',
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('a product id that is not a uuid, or an ID too long to be one, never leaves the action', async () => {
    expect(
      await savePaymentMappingAction('nope', { externalProductId: 'a1', checkoutUrl: '' }),
    ).toEqual({ ok: false, issue: 'generic' });
    expect(
      await savePaymentMappingAction(P, { externalProductId: 'x'.repeat(129), checkoutUrl: '' }),
    ).toEqual({ ok: false, issue: 'generic' });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it.each([
    ['id_required', 'id_required'],
    ['id_taken', 'id_taken'],
    ['link_invalid', 'link_invalid'],
    ['not_found', 'generic'],
    ['forbidden', 'generic'],
    ['generic', 'generic'],
  ])('the API reason %s reads as %s', async (reason, issue) => {
    mocks.put.mockResolvedValue({ ok: false, reason });
    expect(await savePaymentMappingAction(P, { externalProductId: 'a1', checkoutUrl: '' })).toEqual(
      { ok: false, issue },
    );
  });

  it('a refusal the bootstrap knows navigates', async () => {
    mocks.put.mockResolvedValue({ ok: false, reason: 'redirect', path: '/entrar' });
    await expect(
      savePaymentMappingAction(P, { externalProductId: 'a1', checkoutUrl: '' }),
    ).rejects.toThrow('REDIRECT /entrar');
  });

  it('a success revalidates the grid and the product page', async () => {
    await savePaymentMappingAction(P, { externalProductId: 'a1', checkoutUrl: '' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/loja');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/loja/${P}`);
  });

  it('a failure revalidates nothing', async () => {
    mocks.put.mockResolvedValue({ ok: false, reason: 'id_taken' });
    await savePaymentMappingAction(P, { externalProductId: 'a1', checkoutUrl: '' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
