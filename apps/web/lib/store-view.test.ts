import { fileURLToPath } from 'node:url';
import { formatBrl } from '@rede-social/contracts/money';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  priceLabel,
  productCardView,
  productPageView,
  storeFilterFromParam,
  storeFilterHref,
} from './store-view';

/**
 * 08.2-07 — the ONE store formatter (UI-D-383, UI-D-368, UI-D-369). Money is compared against
 * `formatBrl(...)` or an explicit U+00A0, never an ASCII space (Pitfall 12, P20); the web never
 * rounds (P22) and never sorts (P21).
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof priceLabel>[1];

const NBSP = ' ';
const P = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
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
    ...overrides,
  };
}

describe('priceLabel (UI-D-383, P20, P22)', () => {
  it('formats cents exactly through formatBrl, with the NBSP after R$', () => {
    expect(priceLabel(1990, t)).toBe(formatBrl(1990));
    expect(priceLabel(1990, t)).toBe(`R$${NBSP}19,90`);
    expect(priceLabel(10_000_000, t)).toBe(`R$${NBSP}100.000,00`);
    expect(priceLabel(1, t)).toBe(`R$${NBSP}0,01`);
    expect(priceLabel(1990, t)).not.toContain('R$ ');
  });

  it('zero is the catalog word, never R$ 0,00', () => {
    expect(priceLabel(0, t)).toBe('Grátis');
  });
});

describe('storeFilterFromParam (D-352, T-08.2-32)', () => {
  it('maps the pt-BR chip values; anything else reads as all', () => {
    expect(storeFilterFromParam(undefined, false)).toBe('all');
    expect(storeFilterFromParam('todos', false)).toBe('all');
    expect(storeFilterFromParam('comprados', false)).toBe('owned');
    expect(storeFilterFromParam('qualquer', true)).toBe('all');
    expect(storeFilterFromParam(['comprados', 'arquivados'], true)).toBe('all');
  });

  it('arquivados is a manager filter only', () => {
    expect(storeFilterFromParam('arquivados', false)).toBe('all');
    expect(storeFilterFromParam('arquivados', true)).toBe('archived');
  });

  it('builds the chip hrefs', () => {
    expect(storeFilterHref('all')).toBe('/loja');
    expect(storeFilterHref('owned')).toBe('/loja?filtro=comprados');
    expect(storeFilterHref('archived')).toBe('/loja?filtro=arquivados');
  });
});

describe('productCardView (UI-D-368, UI-D-386)', () => {
  const card = { id: P, name: 'Kit', priceCents: 1990, owned: false, imageAssetId: null };

  it('a product the viewer does not hold: no pill, "{product}, {price}"', () => {
    const view = productCardView(card, t, { managerArchived: false });
    expect(view.href).toBe(`/loja/${P}`);
    expect(view.priceLabel).toBe(formatBrl(1990));
    expect(view.ariaLabel).toBe(`Kit, ${formatBrl(1990)}`);
    expect(view.pill).toBeUndefined();
    expect(view.imageAssetId).toBeNull();
    expect(view.imageAlt).toBe('Imagem do produto Kit');
  });

  it('held: the "Comprado" pill and ", comprado"', () => {
    const view = productCardView({ ...card, owned: true }, t, { managerArchived: false });
    expect(view.pill).toEqual({ kind: 'owned', label: 'Comprado' });
    expect(view.ariaLabel).toBe(`Kit, ${formatBrl(1990)}, comprado`);
  });

  it('the manager archived filter: "Arquivado" wins over "Comprado"', () => {
    const view = productCardView({ ...card, owned: true }, t, { managerArchived: true });
    expect(view.pill).toEqual({ kind: 'archived', label: 'Arquivado' });
    expect(view.ariaLabel).toBe('Kit, arquivado');
  });

  it('free: "Grátis" on the card and in the name', () => {
    const view = productCardView({ ...card, priceCents: 0 }, t, { managerArchived: false });
    expect(view.priceLabel).toBe('Grátis');
    expect(view.ariaLabel).toBe('Kit, Grátis');
  });
});

describe('productPageView (UI-D-369, P23, P24, P25)', () => {
  const opts = { canManage: false, communitiesOn: true };

  it('a bare product: back to the Loja, no pill, no action, no unlocks, no manage card', () => {
    const view = productPageView(detail({ description: '' }), t, opts);
    expect(view.back).toEqual({ href: '/loja', label: 'Voltar para a Loja' });
    expect(view.headerPill).toBeNull();
    expect(view.action).toBe('none');
    expect(view.description).toBeNull();
    expect(view.unlocks).toEqual([]);
    expect(view.manage).toBeNull();
    expect(view.priceLabel).toBe(formatBrl(1990));
  });

  it('P24: a whitespace-only description renders no node; P25: text is kept verbatim', () => {
    expect(productPageView(detail({ description: '  \n ' }), t, opts).description).toBeNull();
    const text = 'Linha 1\n\nLinha 2 <b>não é HTML</b>';
    expect(productPageView(detail({ description: text }), t, opts).description).toBe(text);
  });

  it('P23: one active linked community is enough for the section; rows are static until held', () => {
    const product = detail({ communities: [{ id: C1, name: 'Clube', coverAssetId: null }] });
    const view = productPageView(product, t, opts);
    expect(view.unlocks).toEqual([
      {
        id: C1,
        name: 'Clube',
        coverAssetId: null,
        href: null,
        ariaLabel: 'Clube, liberada com a compra',
      },
    ]);
  });

  it('held: the owned block, the success pill, and rows that link to the community', () => {
    const product = detail({
      owned: true,
      communities: [
        { id: C1, name: 'Clube', coverAssetId: null },
        { id: C2, name: 'Bastidores', coverAssetId: null },
      ],
    });
    const view = productPageView(product, t, opts);
    expect(view.action).toBe('owned');
    expect(view.headerPill).toEqual({ tone: 'success', label: 'Comprado' });
    expect(view.unlocks.map((row) => row.href)).toEqual([
      `/comunidades/${C1}`,
      `/comunidades/${C2}`,
    ]);
    expect(view.unlocks[1]?.ariaLabel).toBe('Abrir Bastidores');
  });

  it('D-353: with the communities module off nothing is said about communities', () => {
    const product = detail({ communities: [{ id: C1, name: 'Clube', coverAssetId: null }] });
    expect(productPageView(product, t, { ...opts, communitiesOn: false }).unlocks).toEqual([]);
  });

  it('T-08.2-33: ?comunidade= changes the back target only for a linked community', () => {
    const product = detail({ communities: [{ id: C1, name: 'Clube', coverAssetId: null }] });
    expect(productPageView(product, t, { ...opts, fromCommunity: C1 }).back).toEqual({
      href: `/comunidades/${C1}`,
      label: 'Voltar para Clube',
    });
    for (const foreign of [C2, 'https://evil.example', ['x', C1], '']) {
      expect(productPageView(product, t, { ...opts, fromCommunity: foreign }).back.href).toBe(
        '/loja',
      );
    }
  });

  it('a manager: the Compradores sub-line pluralises 0 / 1 / many', () => {
    const manager = { ...opts, canManage: true };
    expect(productPageView(detail({ holderCount: 0 }), t, manager).manage).toEqual({
      buyersSub: 'Ninguém com acesso ainda',
    });
    expect(productPageView(detail({ holderCount: 1 }), t, manager).manage?.buyersSub).toBe(
      '1 pessoa com acesso',
    );
    expect(productPageView(detail({ holderCount: 12 }), t, manager).manage?.buyersSub).toBe(
      '12 pessoas com acesso',
    );
  });

  it('a manager on an archived product: the neutral pill and the archived note (no buy)', () => {
    const view = productPageView(detail({ status: 'archived', owned: true, holderCount: 3 }), t, {
      ...opts,
      canManage: true,
    });
    expect(view.headerPill).toEqual({ tone: 'neutral', label: 'Arquivado' });
    expect(view.action).toBe('archived');
  });

  it('a holder (not a manager) of an archived product reads it normally, with no archive wording', () => {
    const view = productPageView(detail({ status: 'archived', owned: true }), t, opts);
    expect(view.headerPill).toEqual({ tone: 'success', label: 'Comprado' });
    expect(view.action).toBe('owned');
  });

  it('free product: "Grátis" as the price', () => {
    expect(productPageView(detail({ priceCents: 0 }), t, opts).priceLabel).toBe('Grátis');
  });
});
