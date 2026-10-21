import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOverview, getStoreMapping } from '@/lib/payments';
import { loadProductFormPayment } from '@/lib/product-payment';

/**
 * 09.1-17 (UI-D-524, D-502) — the server read behind the product form's "Pagamento" block: the block
 * is absent (`null`) whenever any read fails, never shown empty over a mapping it could not read.
 */

vi.mock('@/lib/payments', () => ({ getOverview: vi.fn(), getStoreMapping: vi.fn() }));

const P = '11111111-1111-4111-8111-111111111111';
const overview = (connected: boolean) =>
  ({ integration: { gatewayName: 'Pagamentos Exemplo', connected } }) as never;
const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(getOverview).mockReset();
  vi.mocked(getStoreMapping).mockReset();
  logged.mockClear();
});

describe('loadProductFormPayment', () => {
  it('a create reads only the overview and starts with empty fields', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview(true));
    expect(await loadProductFormPayment(null)).toEqual({
      gatewayName: 'Pagamentos Exemplo',
      connected: true,
      externalProductId: '',
      checkoutUrl: '',
    });
    expect(getStoreMapping).not.toHaveBeenCalled();
  });

  it('an edit starts with the saved mapping', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview(true));
    vi.mocked(getStoreMapping).mockResolvedValue({
      ok: true,
      connected: true,
      mapping: { externalProductId: 'a1b2', checkoutUrl: 'https://pay.example/a1b2' },
    });
    expect(await loadProductFormPayment(P)).toEqual({
      gatewayName: 'Pagamentos Exemplo',
      connected: true,
      externalProductId: 'a1b2',
      checkoutUrl: 'https://pay.example/a1b2',
    });
  });

  it('an unmapped product and a mapping without a link read as empty strings', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview(false));
    vi.mocked(getStoreMapping).mockResolvedValue({ ok: true, connected: false, mapping: null });
    expect(await loadProductFormPayment(P)).toMatchObject({
      connected: false,
      externalProductId: '',
      checkoutUrl: '',
    });
    vi.mocked(getStoreMapping).mockResolvedValue({
      ok: true,
      connected: false,
      mapping: { externalProductId: 'a1b2', checkoutUrl: null },
    });
    expect(await loadProductFormPayment(P)).toMatchObject({
      externalProductId: 'a1b2',
      checkoutUrl: '',
    });
  });

  it('a failed mapping read or a failed overview is no block at all', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview(true));
    vi.mocked(getStoreMapping).mockResolvedValue({ ok: false, reason: 'generic' });
    expect(await loadProductFormPayment(P)).toBeNull();
    vi.mocked(getOverview).mockRejectedValue(new Error('boom'));
    expect(await loadProductFormPayment(null)).toBeNull();
    expect(logged).toHaveBeenCalledWith('store.payment_block_unavailable', { error: 'Error' });
  });
});
