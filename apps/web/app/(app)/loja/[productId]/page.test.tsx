// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-17 (PAY-24, PAY-26, D-505, D-506, D-508, UI-D-525, flagged P58) — the product page's action zone
 * by mode. The page is an async server component, so it is called directly with its collaborators
 * mocked and the element it returns is rendered. Simulated mode keeps today's markup (no wrapper);
 * every gateway read gets ONE `aria-live` zone that persists across the unlock; and the gateway branch
 * never reaches the simulated purchase control or its server action.
 */

const mocks = vi.hoisted(() => ({
  product: null as unknown,
  permissions: [] as string[],
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  return { messages: loadMessages(joinPath(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () => createTranslator({ locale: 'pt-BR', messages }),
  };
});

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    modules: [{ key: 'store' }, { key: 'communities' }],
    tenant: { id: 'tenant-1', timezone: 'America/Sao_Paulo' },
    user: { id: 'user-1' },
  }),
}));
vi.mock('@/lib/store', () => ({
  getProduct: async () => ({ status: 'ok', product: mocks.product }),
}));
vi.mock('@rede-social/core/ui', () => ({ MediaImage: () => null }));
vi.mock('./PurchaseControl', () => ({
  PurchaseControl: () => createElement('button', { 'data-testid': 'simulated-control' }, 'Comprar'),
}));
vi.mock('./GatewayPurchase', () => ({
  GatewayPurchase: (props: { checkoutHref: string | null; tenantId: string; userId: string }) =>
    createElement(
      'div',
      {
        'data-testid': 'gateway-control',
        'data-href': props.checkoutHref ?? '',
        'data-tenant': props.tenantId,
        'data-user': props.userId,
      },
      'gateway',
    ),
}));
vi.mock('./ReactivateProduct', () => ({ ReactivateProduct: () => null }));

const { default: ProductPage } = await import('./page');
const { STORE_OWNED_BLOCK_ID } = await import('@/lib/store-view');

const P = '11111111-1111-4111-8111-111111111111';
const LINK = 'https://pay.example/checkout/abc';

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: P,
    name: 'Mentoria em grupo',
    description: 'Encontros mensais.',
    priceCents: 1990,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
    communities: [],
    unlockedCourses: [],
    unlockedLives: [],
    ...overrides,
  };
}

async function renderPage(p: ProductDetail) {
  mocks.product = p;
  const tree = await ProductPage({
    params: Promise.resolve({ productId: P }),
    searchParams: Promise.resolve({}),
  });
  return render(tree);
}

beforeEach(() => {
  mocks.permissions = [];
});
afterEach(cleanup);

describe('product page action zone by mode (09.1-17)', () => {
  it('simulated (no purchase key): today the simulated control and NO live wrapper', async () => {
    await renderPage(product());
    expect(screen.getByTestId('simulated-control')).toBeTruthy();
    expect(screen.queryByTestId('gateway-control')).toBeNull();
    expect(screen.queryByTestId('store-product-action-zone')).toBeNull();
  });

  it('simulated mode with the explicit key is the same', async () => {
    await renderPage(product({ purchase: { mode: 'simulated', checkoutUrl: null } }));
    expect(screen.getByTestId('simulated-control')).toBeTruthy();
    expect(screen.queryByTestId('store-product-action-zone')).toBeNull();
  });

  it('gateway with a link: the gateway control inside ONE polite live zone, never the simulated control', async () => {
    await renderPage(product({ purchase: { mode: 'gateway', checkoutUrl: LINK } }));
    const zone = screen.getByTestId('store-product-action-zone');
    expect(zone.getAttribute('aria-live')).toBe('polite');
    const control = screen.getByTestId('gateway-control');
    expect(zone.contains(control)).toBe(true);
    expect(control.getAttribute('data-href')).toBe(LINK);
    expect(control.getAttribute('data-tenant')).toBe('tenant-1');
    expect(control.getAttribute('data-user')).toBe('user-1');
    expect(screen.queryByTestId('simulated-control')).toBeNull();
  });

  it('gateway with no link or a bad one: the gateway control with no href, never the simulated control (D-508)', async () => {
    for (const checkoutUrl of [null, 'http://pay.example/x', 'javascript:alert(1)']) {
      cleanup();
      await renderPage(product({ purchase: { mode: 'gateway', checkoutUrl } }));
      expect(screen.getByTestId('gateway-control').getAttribute('data-href')).toBe('');
      expect(screen.queryByTestId('simulated-control')).toBeNull();
    }
  });

  it('gateway and held: the owned block, with its focus target, INSIDE the same live zone; no buy control', async () => {
    await renderPage(product({ owned: true, purchase: { mode: 'gateway', checkoutUrl: LINK } }));
    const zone = screen.getByTestId('store-product-action-zone');
    const owned = screen.getByTestId('store-product-owned');
    expect(zone.contains(owned)).toBe(true);
    expect(owned.id).toBe(STORE_OWNED_BLOCK_ID);
    expect(screen.queryByTestId('gateway-control')).toBeNull();
    expect(screen.queryByTestId('simulated-control')).toBeNull();
    // The shipped owned words stay (finding F-2 of the design gate).
    expect(screen.getByText('Comprado')).toBeTruthy();
    expect(screen.getByText('Você tem acesso a este produto.')).toBeTruthy();
  });

  it('simulated and held: the owned block with no wrapper, as today', async () => {
    await renderPage(product({ owned: true }));
    expect(screen.getByTestId('store-product-owned').id).toBe(STORE_OWNED_BLOCK_ID);
    expect(screen.queryByTestId('store-product-action-zone')).toBeNull();
  });

  it('a gateway archived product for its manager keeps the archived note, with no live zone', async () => {
    mocks.permissions = ['store.product.manage'];
    await renderPage(
      product({ status: 'archived', purchase: { mode: 'gateway', checkoutUrl: LINK } }),
    );
    expect(screen.getByTestId('store-product-archived')).toBeTruthy();
    expect(screen.queryByTestId('store-product-action-zone')).toBeNull();
    expect(screen.queryByTestId('gateway-control')).toBeNull();
  });
});

describe('P58: the gateway branch reaches no purchase action', () => {
  it('GatewayPurchase imports neither the purchase action nor the simulated control', () => {
    const source = readFileSync(join(__dirname, 'GatewayPurchase.tsx'), 'utf8');
    expect(source).not.toMatch(/purchaseProductAction/);
    expect(source).not.toMatch(/PurchaseControl/);
    expect(source).not.toMatch(/from '\.\.\/actions'/);
  });
});
