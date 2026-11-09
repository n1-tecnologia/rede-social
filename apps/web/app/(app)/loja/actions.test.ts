import { formatBrl } from '@rede-social/contracts/money';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-17 (UI-D-525, A-P31, T-09.1-82) — the grid's load-more and refresh actions decide who is a
 * manager from the SERVER-side bootstrap, never from an argument: a forged call cannot reveal the
 * manager-only "Sem link de pagamento" pill to a member. The API read and the bootstrap are stubbed;
 * the card view and the pt-BR catalog are real.
 *
 * 2026-10-24 (the Loja area): two surfaces. The BROWSE actions (Produtos, Comprados) draw the member's
 * view for everyone, so even a manager never gets the manager-only pill there; the MANAGE actions
 * (Gerenciar) give a manager the catalogue's state and refuse anyone else before any API read.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  getProducts: vi.fn(),
  requireBootstrap: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock('next-intl/server', async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  const { createTranslator } = await import('next-intl');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return { getTranslations: async () => createTranslator({ locale: 'pt-BR', messages }) };
});
vi.mock('@/lib/bootstrap', () => ({
  ApiClientError: class ApiClientError extends Error {
    status = 0;
    code = '';
  },
  bootstrapRedirectPath: () => null,
  requireBootstrap: mocks.requireBootstrap,
}));
vi.mock('@/lib/store', () => ({
  getProducts: mocks.getProducts,
  purchaseProduct: vi.fn(),
}));

const {
  loadMoreManagedProductsAction,
  loadMoreProductsAction,
  refreshManagedProductsAction,
  refreshProductsAction,
} = await import('./actions');

const P = '11111111-1111-4111-8111-111111111111';
const card = (overrides: Record<string, unknown> = {}) => ({
  id: P,
  name: 'Kit',
  priceCents: 1990,
  currency: 'BRL',
  imageAssetId: null,
  status: 'active',
  owned: false,
  purchase: { mode: 'gateway', checkoutUrl: null },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = [];
  mocks.requireBootstrap.mockImplementation(async () => ({ permissions: mocks.permissions }));
  mocks.getProducts.mockResolvedValue({ items: [card()], nextCursor: null });
});

describe('the store actions read canManage from the bootstrap', () => {
  it('Gerenciar: a manager gets the noLink pill from the refresh and from the load more', async () => {
    mocks.permissions = ['store.product.manage'];
    for (const result of [
      await refreshManagedProductsAction('all'),
      await loadMoreManagedProductsAction('all', 'cursor-1'),
    ]) {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.items[0]?.pill).toEqual({ kind: 'noLink', label: 'Sem link de pagamento' });
      expect(result.items[0]?.ariaLabel).toContain(', sem link de pagamento');
    }
    expect(mocks.requireBootstrap).toHaveBeenCalledTimes(2);
  });

  it('the browse screens never draw the manager pill, even for a manager', async () => {
    mocks.permissions = ['store.product.manage'];
    mocks.getProducts.mockResolvedValue({ items: [card({ owned: true })], nextCursor: null });
    for (const result of [
      await refreshProductsAction('all'),
      await loadMoreProductsAction('owned', 'cursor-1'),
    ]) {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.items[0]?.pill).toEqual({ kind: 'owned', label: 'Comprado' });
    }
    mocks.getProducts.mockResolvedValue({ items: [card()], nextCursor: null });
    const plain = await refreshProductsAction('all');
    expect(plain.ok && plain.items[0]?.pill).toBeUndefined();
  });

  it("Gerenciar shows the catalogue's state: the archived list reads Arquivado, the manager's own holding never shows", async () => {
    mocks.permissions = ['store.product.manage'];
    mocks.getProducts.mockResolvedValue({
      items: [card({ owned: true, status: 'archived' })],
      nextCursor: null,
    });
    const archived = await refreshManagedProductsAction('archived');
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.items[0]?.pill).toEqual({ kind: 'archived', label: 'Arquivado' });
    expect(archived.items[0]?.ariaLabel).toBe('Kit, arquivado');
  });

  it('Gerenciar refuses a member before any API read', async () => {
    mocks.permissions = ['feed.post'];
    expect(await refreshManagedProductsAction('all')).toEqual({ ok: false, code: 'generic' });
    expect(await loadMoreManagedProductsAction('archived', 'cursor-1')).toEqual({
      ok: false,
      code: 'generic',
    });
    expect(mocks.getProducts).not.toHaveBeenCalled();
  });

  it('each surface answers only its own lists', async () => {
    mocks.permissions = ['store.product.manage'];
    expect(await refreshProductsAction('archived')).toEqual({ ok: false, code: 'generic' });
    expect(await refreshManagedProductsAction('owned')).toEqual({ ok: false, code: 'generic' });
    expect(mocks.getProducts).not.toHaveBeenCalled();
  });

  it('a member never gets the pill, whatever the product says', async () => {
    mocks.permissions = ['feed.post'];
    const result = await refreshProductsAction('all');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]?.pill).toBeUndefined();
    expect(result.items[0]?.ariaLabel).toBe(`Kit, ${formatBrl(1990)}`);
  });

  it('the signatures take no manager flag: a third argument changes nothing', async () => {
    mocks.permissions = [];
    // biome-ignore lint/suspicious/noExplicitAny: a forged extra argument on purpose
    const forged = await (refreshProductsAction as any)('all', true);
    expect(forged.ok).toBe(true);
    expect(forged.items[0]?.pill).toBeUndefined();
  });

  it('a bootstrap refusal navigates instead of rendering', async () => {
    mocks.requireBootstrap.mockRejectedValue(new Error('REDIRECT /entrar'));
    await expect(refreshProductsAction('all')).rejects.toThrow('REDIRECT /entrar');
  });
});
