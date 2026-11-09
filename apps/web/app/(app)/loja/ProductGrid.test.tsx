// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productCardView } from '@/lib/store-view';

/**
 * 2026-10-24 — the poster grid of Produtos and Comprados (the Loja area), against the REAL pt-BR
 * catalog and the real card views: the member catalogue's columns, the screen's own empty cards and
 * the first-load retry through the BROWSE actions (never Gerenciar's). The server actions are stubs;
 * `PullToRefresh` is a plain wrapper (happy-dom has no touch pull). No next page, so the sentinel
 * never mounts. Plain DOM assertions (the web workspace has no jest-dom).
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

const actions = vi.hoisted(() => ({
  refreshProductsAction: vi.fn(),
  loadMoreProductsAction: vi.fn(),
  refreshManagedProductsAction: vi.fn(),
  loadMoreManagedProductsAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    PullToRefresh: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { ProductGrid } = await import('./ProductGrid');

const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as Parameters<
  typeof productCardView
>[1];

const KIT = productCardView(
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Kit de protocolos',
    priceCents: 9700,
    owned: true,
    imageAssetId: null,
  },
  t,
  { managerArchived: false },
);
const EBOOK = productCardView(
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'E-book',
    priceCents: 0,
    owned: false,
    imageAssetId: null,
  },
  t,
  { managerArchived: false },
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ProductGrid — Produtos and Comprados (2026-10-24)', () => {
  it("draws the posters in the member catalogue's columns, one link per product, named by the view", () => {
    render(
      <ProductGrid
        filter="all"
        tenantName="Rede Demo"
        initialItems={[KIT, EBOOK]}
        initialCursor={null}
      />,
    );
    const grid = screen.getByRole('list', { name: 'Produtos de Rede Demo' });
    // The columns follow the room the grid has (its frame is a container), not the screen.
    expect(grid.parentElement?.className).toContain('@container');
    for (const cls of [
      'grid-cols-2',
      '@min-[600px]:grid-cols-3',
      '@min-[880px]:grid-cols-4',
      '@min-[1200px]:grid-cols-5',
    ]) {
      expect(grid.className).toContain(cls);
    }
    const links = grid.querySelectorAll('a[data-testid="product-card"]');
    expect([...links].map((link) => link.getAttribute('aria-label'))).toEqual([
      KIT.ariaLabel,
      EBOOK.ariaLabel,
    ]);
    expect(KIT.ariaLabel).toContain('comprado');
    expect(screen.getByTestId('product-card-pill').textContent).toBe('Comprado');
    // The retail tile (2026-10-27): the name and the price under the stage, inside the card, no button.
    const [kit, ebook] = [...links];
    expect(kit?.querySelector('[data-testid="product-card-price"]')?.textContent).toBe(
      KIT.priceLabel,
    );
    expect(
      kit
        ?.querySelector('[data-testid="product-card-image"], [data-testid="product-card-fallback"]')
        ?.contains(kit.querySelector('[data-testid="product-card-price"]')),
    ).toBe(false);
    expect(ebook?.querySelector('[data-testid="product-card-price"]')?.textContent).toBe('Grátis');
    expect(grid.querySelector('button')).toBeNull();
  });

  it('Produtos with nothing on sale: the member empty card, with no create call to action', () => {
    render(
      <ProductGrid filter="all" tenantName="Rede Demo" initialItems={[]} initialCursor={null} />,
    );
    const empty = screen.getByTestId('store-empty');
    expect(empty.textContent).toContain('Nenhum produto por aqui ainda');
    expect(empty.textContent).toContain('Quando Rede Demo publicar produtos, eles aparecem aqui.');
    expect(empty.querySelector('a')).toBeNull();
  });

  it('Comprados with nothing held: the owned empty card and "Ver todos" back to Produtos', () => {
    render(
      <ProductGrid filter="owned" tenantName="Rede Demo" initialItems={[]} initialCursor={null} />,
    );
    const empty = screen.getByTestId('store-empty-owned');
    expect(empty.textContent).toContain('Você ainda não tem produtos');
    expect(empty.querySelector('a')?.getAttribute('href')).toBe('/loja');
    expect(empty.querySelector('a')?.textContent).toBe('Ver todos');
  });

  it('a failed first page retries through the BROWSE refresh and shows what it returns', async () => {
    actions.refreshProductsAction.mockResolvedValue({ ok: true, items: [EBOOK], nextCursor: null });
    render(
      <ProductGrid
        filter="owned"
        tenantName="Rede Demo"
        initialItems={[]}
        initialCursor={null}
        initialError
      />,
    );
    const error = screen.getByTestId('store-error');
    const retry = error.querySelector('button');
    expect(retry?.textContent).toBe('Tentar novamente');
    await act(async () => {
      fireEvent.click(retry as HTMLButtonElement);
    });
    expect(actions.refreshProductsAction).toHaveBeenCalledWith('owned');
    expect(actions.refreshManagedProductsAction).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: EBOOK.ariaLabel })).toBeTruthy();
    expect(screen.queryByTestId('store-error')).toBeNull();
  });
});
