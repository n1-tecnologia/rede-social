// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productManageView } from '@/lib/store-view';

/**
 * 2026-10-24 — Gerenciar's rows (the Loja area), against the REAL pt-BR catalog and the real row
 * views (`productManageView`): the outlined list card of `ProductRow`s with the catalogue's pills,
 * each opening the product page; the manager's empty cards; the first-load retry through the
 * MANAGE actions. The server actions are stubs; `PullToRefresh` is a plain wrapper. Plain DOM
 * assertions (the web workspace has no jest-dom).
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

const { ProductsManageList } = await import('./ProductsManageList');

const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as Parameters<
  typeof productManageView
>[1];

const MENTORIA = productManageView(
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Mentoria individual',
    priceCents: 149700,
    owned: true,
    imageAssetId: null,
    status: 'active',
    purchase: { mode: 'gateway', checkoutUrl: null },
  },
  t,
  { archived: false, canManage: true },
);
const IMERSAO = productManageView(
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Imersão presencial',
    priceCents: 240000,
    owned: false,
    imageAssetId: null,
    status: 'archived',
  },
  t,
  { archived: true, canManage: true },
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ProductsManageList — Gerenciar (2026-10-24)', () => {
  it('draws one row per product in the outlined list card, each opening its product page', () => {
    render(
      <ProductsManageList
        filter="all"
        tenantName="Rede Demo"
        initialItems={[MENTORIA]}
        initialCursor={null}
      />,
    );
    const list = screen.getByRole('list', { name: 'Produtos de Rede Demo' });
    expect(list.tagName).toBe('OL');
    expect(list.className).toContain('lg:grid-cols-2');
    const row = list.querySelector('a[data-testid="product-row"]');
    expect(row?.getAttribute('href')).toBe('/loja/11111111-1111-4111-8111-111111111111');
    // The catalogue's state, not the manager's own holding: the missing link, never "Comprado".
    const pill = screen.getByTestId('product-row-pill');
    expect(pill.getAttribute('data-kind')).toBe('noLink');
    expect(pill.textContent).toBe('Sem link de pagamento');
  });

  it('the archived list reads "Arquivado" on each row', () => {
    render(
      <ProductsManageList
        filter="archived"
        tenantName="Rede Demo"
        initialItems={[IMERSAO]}
        initialCursor={null}
      />,
    );
    expect(screen.getByRole('link', { name: 'Imersão presencial, arquivado' })).toBeTruthy();
    expect(screen.getByTestId('product-row-pill').textContent).toBe('Arquivado');
  });

  it('an empty archived list says so; an empty active list offers "Criar produto"', () => {
    render(
      <ProductsManageList
        filter="archived"
        tenantName="Rede Demo"
        initialItems={[]}
        initialCursor={null}
      />,
    );
    expect(screen.getByTestId('store-empty-archived').textContent).toContain(
      'Nenhum produto arquivado',
    );
    cleanup();

    render(
      <ProductsManageList
        filter="all"
        tenantName="Rede Demo"
        initialItems={[]}
        initialCursor={null}
      />,
    );
    const empty = screen.getByTestId('store-empty');
    expect(empty.textContent).toContain('Crie o primeiro produto');
    const create = empty.querySelector('a');
    expect(create?.getAttribute('href')).toBe('/loja/novo');
    expect(create?.textContent).toBe('Criar produto');
  });

  it('a failed first page retries through the MANAGE refresh', async () => {
    actions.refreshManagedProductsAction.mockResolvedValue({
      ok: true,
      items: [IMERSAO],
      nextCursor: null,
    });
    render(
      <ProductsManageList
        filter="archived"
        tenantName="Rede Demo"
        initialItems={[]}
        initialCursor={null}
        initialError
      />,
    );
    const retry = screen.getByTestId('store-error').querySelector('button');
    await act(async () => {
      fireEvent.click(retry as HTMLButtonElement);
    });
    expect(actions.refreshManagedProductsAction).toHaveBeenCalledWith('archived');
    expect(actions.refreshProductsAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-row')).toBeTruthy();
  });
});
