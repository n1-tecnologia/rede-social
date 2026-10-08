import { fileURLToPath } from 'node:url';
import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { formatBrl, parseBrlToCents } from '@rede-social/contracts/money';
import type { ProductDetail } from '@rede-social/module-store/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  communityTagsView,
  lockedPageView,
  priceInputText,
  priceLabel,
  productCardView,
  productFormDefaults,
  productPageView,
  purchaseBodyText,
  purchaseConfirmView,
  storeFilterFromParam,
  storeFilterHref,
  successView,
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

  it('a bare product: back to the Loja, no pill, the buy control, no unlocks, no manage card', () => {
    const view = productPageView(detail({ description: '' }), t, opts);
    expect(view.back).toEqual({ href: '/loja', label: 'Voltar para a Loja' });
    expect(view.headerPill).toBeNull();
    // 08.2-08: an active product the viewer does not hold gets "Comprar" / "Obter".
    expect(view.action).toBe('buy');
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

function community(n: number, name = `Comunidade ${n}`) {
  return {
    id: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
    name,
    coverAssetId: null,
  };
}

describe('purchaseBodyText (UI-D-370, P26, D-361)', () => {
  it('no community: the price and the access line, NBSP after R$', () => {
    expect(purchaseBodyText(detail(), t)).toBe(
      `R$${NBSP}19,90. O acesso é liberado assim que você confirmar.`,
    );
  });

  it('R$ 0 reads "Grátis", never R$ 0,00', () => {
    expect(
      purchaseBodyText(detail({ priceCents: 0, communities: [community(1, 'Clube')] }), t),
    ).toBe('Grátis. O acesso a Clube é liberado assim que você confirmar.');
  });

  it('two communities: the pt-BR conjunction "A e B"', () => {
    const body = purchaseBodyText(
      detail({
        priceCents: 19_700,
        communities: [community(1, 'Mentoria ao vivo'), community(2, 'Bastidores')],
      }),
      t,
    );
    expect(body).toBe(
      `R$${NBSP}197,00. O acesso a Mentoria ao vivo e Bastidores é liberado assim que você confirmar.`,
    );
  });

  it('four communities: two names, then "e mais 2" — never "e e mais"', () => {
    const body = purchaseBodyText(
      detail({
        priceCents: 12_000,
        communities: [community(1, 'A'), community(2, 'B'), community(3, 'C'), community(4, 'D')],
      }),
      t,
    );
    expect(body).toBe(
      `R$${NBSP}120,00. O acesso a A, B e mais 2 é liberado assim que você confirmar.`,
    );
    expect(body).not.toContain('e e mais');
    expect(body).not.toContain('C');
  });

  it('three communities: "A, B e mais 1"', () => {
    const body = purchaseBodyText(
      detail({ communities: [community(1, 'A'), community(2, 'B'), community(3, 'C')] }),
      t,
    );
    expect(body).toContain('O acesso a A, B e mais 1 é liberado');
  });

  it('P26: the body opens with exactly the priceLabel the page prints', () => {
    for (const cents of [0, 1, 1990, 10_000_000]) {
      expect(purchaseBodyText(detail({ priceCents: cents }), t)).toBe(
        `${priceLabel(cents, t)}. O acesso é liberado assim que você confirmar.`,
      );
    }
  });

  it('UI-D-388: no payment vocabulary in any variant', () => {
    const bodies = [
      purchaseBodyText(detail(), t),
      purchaseBodyText(detail({ priceCents: 0, communities: [community(1)] }), t),
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(/pagamento|pagar|cartão|pix|checkout|carrinho|reembolso|estorno/i);
    }
  });
});

describe('purchaseConfirmView (D-361)', () => {
  it('a priced product: "Comprar" and "Comprar {product}?"', () => {
    const view = purchaseConfirmView(detail(), t);
    expect(view).toEqual({
      buyLabel: 'Comprar',
      title: 'Comprar Mentoria em grupo?',
      body: purchaseBodyText(detail(), t),
      confirmLabel: 'Confirmar',
      pendingLabel: 'Confirmando…',
      cancelLabel: 'Cancelar',
    });
  });

  it('R$ 0: "Obter" and "Obter {product}?"', () => {
    const view = purchaseConfirmView(detail({ priceCents: 0 }), t);
    expect(view.buyLabel).toBe('Obter');
    expect(view.title).toBe('Obter Mentoria em grupo?');
  });
});

describe('successView (UI-D-370 b, P27, P28)', () => {
  it('P28: no community → "{product} agora é seu." with only "Fechar", no list, no link', () => {
    const view = successView(detail(), [], t);
    expect(view).toEqual({
      variant: 'none',
      title: 'Compra concluída',
      body: 'Mentoria em grupo agora é seu.',
      communities: [],
      primary: null,
      closeLabel: 'Fechar',
    });
  });

  it('one community → its body and "Ir para a comunidade" to /comunidades/{id}', () => {
    const one = community(1, 'Clube de leitura');
    const view = successView(detail(), [one], t);
    expect(view.variant).toBe('one');
    expect(view.body).toBe('Clube de leitura já está liberada para você.');
    expect(view.primary).toEqual({ href: `/comunidades/${one.id}`, label: 'Ir para a comunidade' });
    expect(view.communities).toEqual([]);
  });

  it('several → the list in the answered order, hrefs built from each row', () => {
    const rows = [community(1, 'A'), community(2, 'B'), community(3, 'C')];
    const view = successView(detail(), rows, t);
    expect(view.variant).toBe('several');
    expect(view.body).toBe('Estas comunidades já estão liberadas para você:');
    expect(view.primary).toBeNull();
    expect(view.communities.map((c) => [c.name, c.href])).toEqual(
      rows.map((row) => [row.name, `/comunidades/${row.id}`]),
    );
  });

  it('P27: the same answer (a purchase or an owned replay) yields the same view', () => {
    const rows = [community(1), community(2)];
    expect(successView(detail(), rows, t)).toEqual(successView(detail(), [...rows], t));
  });
});

describe('productPageView action zone (08.2-08)', () => {
  const opts = { canManage: false, communitiesOn: true };
  it('held → owned; active and not held → buy; a manager on archived → archived', () => {
    expect(productPageView(detail({ owned: true }), t, opts).action).toBe('owned');
    expect(productPageView(detail(), t, opts).action).toBe('buy');
    expect(productPageView(detail({ priceCents: 0 }), t, opts).action).toBe('buy');
    expect(
      productPageView(detail({ status: 'archived' }), t, { ...opts, canManage: true }).action,
    ).toBe('archived');
    // An archived product nobody here may buy is never a buy control.
    expect(productPageView(detail({ status: 'archived' }), t, opts).action).toBe('none');
  });
});

describe('communityTagsView (08.2-09, UI-D-372 who sees what, P44)', () => {
  const gatedLocked = { locked: true, gated: true, archivedTag: false };
  const gatedOpen = { locked: false, gated: true, archivedTag: false };
  const member = { canManage: false, isSupport: false };
  const manager = { canManage: true, isSupport: false };
  const support = { canManage: false, isSupport: true };

  it('a member without access sees Exclusiva; a holder sees nothing', () => {
    expect(communityTagsView(gatedLocked, member)).toEqual({ coverBadge: true, archived: false });
    expect(communityTagsView(gatedOpen, member)).toEqual({ coverBadge: false, archived: false });
  });

  it('Produto arquivado joins Exclusiva when no linked product is active, never alone', () => {
    expect(communityTagsView({ ...gatedLocked, archivedTag: true }, member)).toEqual({
      coverBadge: true,
      archived: true,
    });
    expect(communityTagsView({ ...gatedOpen, archivedTag: true }, member)).toEqual({
      coverBadge: false,
      archived: false,
    });
  });

  it('a manager sees Exclusiva on every gated community (locked is false for staff)', () => {
    expect(communityTagsView(gatedOpen, manager)).toEqual({ coverBadge: true, archived: false });
    expect(communityTagsView({ ...gatedOpen, archivedTag: true }, manager)).toEqual({
      coverBadge: true,
      archived: true,
    });
  });

  it('support_tenant sees no tag; no access row (open, store off, read failed) means no tag', () => {
    expect(communityTagsView(gatedLocked, support)).toEqual({ coverBadge: false, archived: false });
    expect(communityTagsView(undefined, member)).toEqual({ coverBadge: false, archived: false });
    expect(communityTagsView(null, manager)).toEqual({ coverBadge: false, archived: false });
  });
});

describe('lockedPageView (08.2-09, UI-D-373, P49, P53, P54, P84)', () => {
  const product = (id: string, name: string, priceCents: number) => ({
    id,
    name,
    priceCents,
    imageAssetId: null,
  });
  const one = {
    communityId: C1,
    archivedTag: false,
    buyableProducts: [product(P, 'Mentoria', 1990)],
  };
  const opts = { communityName: 'Bastidores', fromPost: false };

  it('P49: placeholders are min(3, N) and the count shows only from N = 1', () => {
    expect(lockedPageView(one, 0, opts, t)).toMatchObject({ placeholders: 0, showCount: false });
    expect(lockedPageView(one, 1, opts, t)).toMatchObject({ placeholders: 1, showCount: true });
    expect(lockedPageView(one, 2, opts, t)).toMatchObject({ placeholders: 2, showCount: true });
    expect(lockedPageView(one, 3, opts, t)).toMatchObject({ placeholders: 3, showCount: true });
    expect(lockedPageView(one, 201, opts, t)).toMatchObject({ placeholders: 3, showCount: true });
  });

  it('P84: the count line is the exact N through the ICU plural, never capped', () => {
    expect(lockedPageView(one, 1, opts, t).countLine).toBe('+ 1 publicação exclusiva');
    expect(lockedPageView(one, 4, opts, t).countLine).toBe('+ 4 publicações exclusivas');
    expect(lockedPageView(one, 1234, opts, t).countLine).toBe('+ 1.234 publicações exclusivas');
  });

  it('one buyable product: Ver produto links to the product with ?comunidade=', () => {
    const view = lockedPageView(one, 4, opts, t);
    expect(view.section).toBe('one');
    expect(view.actionLabel).toBe('Ver produto');
    expect(view.productHref).toBe(`/loja/${P}?comunidade=${C1}`);
    expect(view.sectionBody).toBe(
      'Compre Mentoria para ver todas as publicações de Bastidores, curtir e comentar.',
    );
    expect(view.countBody).toBe('Quem tem acesso vê todas as publicações de Bastidores.');
    expect(view.choices).toEqual([]);
  });

  it('one free product uses the Obtenha body', () => {
    const free = { ...one, buyableProducts: [product(P, 'Boas-vindas', 0)] };
    expect(lockedPageView(free, 1, opts, t).sectionBody).toBe(
      'Obtenha Boas-vindas grátis para ver todas as publicações de Bastidores, curtir e comentar.',
    );
  });

  it('P53: several buyable products → Ver opções and the sheet rows in server order', () => {
    const many = {
      communityId: C1,
      archivedTag: false,
      buyableProducts: [product(P, 'Mentoria', 1990), product(C2, 'Encontro', 0)],
    };
    const view = lockedPageView(many, 2, opts, t);
    expect(view.section).toBe('many');
    expect(view.actionLabel).toBe('Ver opções');
    expect(view.productHref).toBeNull();
    expect(view.sectionBody).toBe(
      'Escolha um produto para ver todas as publicações de Bastidores, curtir e comentar.',
    );
    expect(view.choices.map((row) => row.href)).toEqual([
      `/loja/${P}?comunidade=${C1}`,
      `/loja/${C2}?comunidade=${C1}`,
    ]);
    expect(view.choices[0]?.priceLabel).toBe(formatBrl(1990));
    expect(view.choices[1]?.priceLabel).toBe('Grátis');
    expect(view.choices[1]?.ariaLabel).toBe('Encontro, Grátis');
    expect(view.choiceTitle).toBe('Opções de acesso');
    expect(view.choiceHelper).toBe('Qualquer um destes produtos libera Bastidores.');
  });

  it('P54: nothing buyable → no section, no action, the unavailable body', () => {
    const none = { communityId: C1, archivedTag: true, buyableProducts: [] };
    const view = lockedPageView(none, 1, opts, t);
    expect(view.section).toBe('none');
    expect(view.actionLabel).toBeNull();
    expect(view.sectionBody).toBeNull();
    expect(view.countBody).toBe('Esta comunidade não está à venda no momento.');
    expect(view.archivedTag).toBe(true);
  });

  it('?exclusivo=1 adds the from-post line; otherwise none', () => {
    expect(lockedPageView(one, 1, opts, t).fromPost).toBeNull();
    expect(lockedPageView(one, 1, { ...opts, fromPost: true }, t).fromPost).toBe(
      'A publicação que você abriu faz parte deste conteúdo exclusivo.',
    );
  });

  it('UI-D-388: no member-facing locked copy says bloqueada, trancada or premium', () => {
    const view = lockedPageView(one, 3, { ...opts, fromPost: true }, t);
    const text = JSON.stringify(view).toLowerCase();
    for (const word of ['bloquead', 'trancad', 'premium']) expect(text).not.toContain(word);
  });
});

describe('priceInputText (08.2-10, UI-D-383)', () => {
  it('shows cents with two decimals and pt-BR thousand groups, built from integers', () => {
    expect(priceInputText(1990)).toBe('19,90');
    expect(priceInputText(1900)).toBe('19,00');
    expect(priceInputText(0)).toBe('0,00');
    expect(priceInputText(5)).toBe('0,05');
    expect(priceInputText(123450)).toBe('1.234,50');
    expect(priceInputText(10_000_000)).toBe('100.000,00');
  });

  it('round-trips through parseBrlToCents', () => {
    for (const cents of [0, 1, 99, 100, 1990, 123450, 9_999_999, 10_000_000]) {
      expect(parseBrlToCents(priceInputText(cents))).toBe(cents);
    }
  });
});

describe('productFormDefaults (08.2-10, UI-D-377)', () => {
  it('fills the edit form from the product: price text from cents, links with the cover ladder', () => {
    const defaults = productFormDefaults(
      detail({
        priceCents: 19700,
        imageAssetId: C1,
        status: 'archived',
        communities: [{ id: C2, name: 'Bastidores', coverAssetId: null }],
      }),
    );
    expect(defaults).toEqual({
      name: 'Mentoria em grupo',
      description: 'Encontros mensais.',
      priceText: '197,00',
      priceCents: 19700,
      imageAssetId: C1,
      communities: [
        {
          id: C2,
          name: 'Bastidores',
          coverAssetId: null,
          coverVariantWidths: PURPOSE_WIDTHS.cover,
        },
      ],
      status: 'archived',
    });
  });
});
