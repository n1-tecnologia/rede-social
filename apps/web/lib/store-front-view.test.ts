import { fileURLToPath } from 'node:url';
import type { ProductCard } from '@rede-social/module-store/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  parseStoreQuery,
  relatedItems,
  storeFrontView,
  storeHref,
  storeItems,
  storeListingView,
} from './store-front-view';
import {
  EMPTY_STORE_SETUP,
  NO_CATEGORY,
  productKey,
  STORE_CATEGORY_MAX,
  storeCategoryList,
} from './store-setup';

/**
 * 2026-10-27 — the storefront's view (the product owner: "cards maiores, destaque em itens, esquema
 * de prateleiras de itens, categorias"): the hero, the category tiles, a shelf per category, a
 * category's page and the search with their orders. Words from the real pt-BR catalog.
 *
 * 2026-10-28: the categories are the store's own (`lib/store-setup.ts`): the built-in eight here,
 * and one case with the categories and the featured list Gerenciar keeps.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof storeItems>[1];

let seq = 0;
function product(
  name: string,
  priceCents: number,
  overrides: Partial<ProductCard> = {},
): ProductCard {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name,
    priceCents,
    currency: 'BRL',
    imageAssetId: null,
    status: 'active',
    owned: false,
    ...overrides,
  };
}

// The API's order: newest first.
const PRODUCTS = [
  product('Perfume Signature 100 ml', 32900),
  product('Dermapen Pro Sem Fio', 189000),
  product('Jaleco Premium Bordado', 24900),
  product('Body Splash Pele de Seda 200 ml', 7990),
  product('Camiseta Oversized Rede Demo', 8990),
  product('Boné Aba Curva Rede Demo', 6990),
  product('E-book: Primeira Consulta', 0, { owned: true }),
];
const CATEGORIES = storeCategoryList(EMPTY_STORE_SETUP, t);
const IDS = CATEGORIES.map((category) => category.id);
const ITEMS = storeItems(PRODUCTS, t, { categories: CATEGORIES, assignments: new Map() });
const ID = (index: number) => PRODUCTS[index]?.id ?? '';

describe('storeItems', () => {
  it('each product with its category, its chip and its price', () => {
    expect(ITEMS.map((item) => [item.category, item.tag])).toEqual([
      ['perfumes', 'Perfume'],
      ['equipamentos', 'Equipamento'],
      ['roupas', 'Roupa'],
      ['perfumes', 'Perfume'],
      ['roupas', 'Roupa'],
      ['roupas', 'Roupa'],
      ['livros', 'Livro'],
    ]);
    expect(ITEMS[0]?.href).toBe(`/loja/${ID(0)}`);
    expect(ITEMS[6]?.pill).toEqual({ kind: 'owned', label: 'Comprado' });
    expect(ITEMS[6]?.priceLabel).toBe('Grátis');
  });
});

describe('storeFrontView', () => {
  it('the hero is the newest with the next four; the tiles and the shelves follow the categories', () => {
    const view = storeFrontView(ITEMS, t, { categories: CATEGORIES });
    expect(view.hero?.main.name).toBe('Perfume Signature 100 ml');
    expect(view.hero?.side.map((item) => item.name)).toEqual([
      'Dermapen Pro Sem Fio',
      'Jaleco Premium Bordado',
      'Body Splash Pele de Seda 200 ml',
      'Camiseta Oversized Rede Demo',
    ]);
    // The storefront's order (livros, roupas, perfumes, equipamentos), only the ones with products.
    expect(view.categories.map((tile) => [tile.key, tile.count, tile.href])).toEqual([
      ['livros', '1 produto', '/loja?categoria=livros'],
      ['roupas', '3 produtos', '/loja?categoria=roupas'],
      ['perfumes', '2 produtos', '/loja?categoria=perfumes'],
      ['equipamentos', '1 produto', '/loja?categoria=equipamentos'],
    ]);
    expect(view.categories[1]?.ariaLabel).toBe('Roupas, 3 produtos');
    const roupas = view.shelves.find((shelf) => shelf.key === 'roupas');
    expect(roupas).toMatchObject({
      title: 'Roupas',
      sub: '3 produtos',
      seeAll: {
        href: '/loja?categoria=roupas',
        label: 'Ver tudo',
        ariaLabel: 'Ver tudo em Roupas',
      },
    });
    expect(roupas?.items.map((item) => item.name)).toEqual([
      'Jaleco Premium Bordado',
      'Camiseta Oversized Rede Demo',
      'Boné Aba Curva Rede Demo',
    ]);
  });

  it("the administrator's featured product leads the hero, never twice", () => {
    const view = storeFrontView(ITEMS, t, { categories: CATEGORIES, featured: [ID(4)] });
    expect(view.hero?.main.name).toBe('Camiseta Oversized Rede Demo');
    expect(view.hero?.side.map((item) => item.name)).toEqual([
      'Perfume Signature 100 ml',
      'Dermapen Pro Sem Fio',
      'Jaleco Premium Bordado',
      'Body Splash Pele de Seda 200 ml',
    ]);
    // An id that is not for sale any more falls back to the newest.
    expect(
      storeFrontView(ITEMS, t, { categories: CATEGORIES, featured: ['gone'] }).hero?.main.name,
    ).toBe('Perfume Signature 100 ml');
  });

  it('the featured list in its order: the first large, the others beside it, then the newest', () => {
    const view = storeFrontView(ITEMS, t, {
      categories: CATEGORIES,
      featured: [ID(5), 'gone', ID(2)],
    });
    expect(view.hero?.main.name).toBe('Boné Aba Curva Rede Demo');
    expect(view.hero?.side.map((item) => item.name)).toEqual([
      'Jaleco Premium Bordado',
      'Perfume Signature 100 ml',
      'Dermapen Pro Sem Fio',
      'Body Splash Pele de Seda 200 ml',
    ]);
  });

  it("Gerenciar's categories: its names, glyphs and order, a product's choice over its name", () => {
    const categories = storeCategoryList(
      {
        categories: [
          { id: 'skincare', name: 'Skincare', icon: 'sparkles' },
          { id: 'roupas', name: 'Vestuário', icon: 'shirt' },
          { id: 'perfumes', name: 'Perfumes', icon: 'spray-can' },
        ],
        featured: [],
      },
      t,
    );
    const items = storeItems(PRODUCTS, t, {
      categories,
      assignments: new Map([
        [productKey(ID(3)), 'skincare'],
        [productKey(ID(5)), NO_CATEGORY],
      ]),
    });
    expect(items.map((item) => [item.category, item.tag])).toEqual([
      ['perfumes', 'Perfume'],
      [null, ''],
      ['roupas', 'Vestuário'],
      ['skincare', 'Skincare'],
      ['roupas', 'Vestuário'],
      [null, ''],
      [null, ''],
    ]);
    const view = storeFrontView(items, t, { categories });
    expect(view.categories.map((tile) => [tile.key, tile.name, tile.icon, tile.count])).toEqual([
      ['skincare', 'Skincare', 'sparkles', '1 produto'],
      ['roupas', 'Vestuário', 'shirt', '2 produtos'],
      ['perfumes', 'Perfumes', 'spray-can', '1 produto'],
    ]);
    expect(view.shelves.map((shelf) => shelf.title)).toEqual(['Skincare', 'Vestuário', 'Perfumes']);
    // A category the store no longer keeps is no address; one it keeps names the page.
    const ids = categories.map((category) => category.id);
    expect(parseStoreQuery({ categoria: 'livros' }, ids).categoria).toBeNull();
    expect(
      storeListingView(items, parseStoreQuery({ categoria: 'skincare' }, ids), t, categories).title,
    ).toBe('Skincare');
    expect(STORE_CATEGORY_MAX).toBe(20);
  });

  it('an empty store has no hero, no tile and no shelf', () => {
    expect(storeFrontView([], t, { categories: CATEGORIES })).toEqual({
      hero: null,
      categories: [],
      shelves: [],
    });
  });
});

describe('storeListingView', () => {
  it("a category's page in the three orders, the API's order breaking ties", () => {
    const query = parseStoreQuery({ categoria: 'roupas' }, IDS);
    const recent = storeListingView(ITEMS, query, t, CATEGORIES);
    expect(recent.title).toBe('Roupas');
    expect(recent.sub).toBe('3 produtos');
    expect(recent.items.map((item) => item.priceCents)).toEqual([24900, 8990, 6990]);
    expect(recent.sorts.map((sort) => [sort.label, sort.href, sort.active])).toEqual([
      ['Mais recentes', '/loja?categoria=roupas', true],
      ['Menor preço', '/loja?categoria=roupas&ordem=menor-preco', false],
      ['Maior preço', '/loja?categoria=roupas&ordem=maior-preco', false],
    ]);
    const cheap = storeListingView(ITEMS, { ...query, ordem: 'menor-preco' }, t, CATEGORIES);
    expect(cheap.items.map((item) => item.priceCents)).toEqual([6990, 8990, 24900]);
    const dear = storeListingView(ITEMS, { ...query, ordem: 'maior-preco' }, t, CATEGORIES);
    expect(dear.items.map((item) => item.priceCents)).toEqual([24900, 8990, 6990]);
  });

  it('the search holds every word of it, accents and case aside', () => {
    const view = storeListingView(
      ITEMS,
      parseStoreQuery({ busca: 'REDE demo' }, IDS),
      t,
      CATEGORIES,
    );
    expect(view.title).toBe('Busca');
    expect(view.items.map((item) => item.name)).toEqual([
      'Camiseta Oversized Rede Demo',
      'Boné Aba Curva Rede Demo',
    ]);
    expect(view.sub).toBe('2 resultados para “REDE demo”');
    expect(
      storeListingView(ITEMS, parseStoreQuery({ busca: 'bone' }, IDS), t, CATEGORIES).sub,
    ).toBe('1 resultado para “bone”');
    expect(storeListingView(ITEMS, parseStoreQuery({ busca: 'xyz' }, IDS), t, CATEGORIES).sub).toBe(
      'Nenhum resultado para “xyz”',
    );
  });
});

describe('the address', () => {
  it('reads leniently: an unknown category or order is the plain storefront', () => {
    expect(parseStoreQuery({}, IDS)).toEqual({ categoria: null, busca: null, ordem: 'recentes' });
    expect(parseStoreQuery({ categoria: 'carros', ordem: 'aleatorio', busca: '   ' }, IDS)).toEqual(
      {
        categoria: null,
        busca: null,
        ordem: 'recentes',
      },
    );
    expect(parseStoreQuery({ categoria: ['livros', 'roupas'], busca: ' guia ' }, IDS)).toEqual({
      categoria: 'livros',
      busca: 'guia',
      ordem: 'recentes',
    });
  });

  it('writes back without the default order', () => {
    expect(storeHref({})).toBe('/loja');
    expect(storeHref({ categoria: 'perfumes', ordem: 'recentes' })).toBe(
      '/loja?categoria=perfumes',
    );
    expect(storeHref({ busca: 'rede demo', ordem: 'menor-preco' })).toBe(
      '/loja?busca=rede+demo&ordem=menor-preco',
    );
  });
});

describe('relatedItems', () => {
  it('the same category first, then the rest, never the product itself', () => {
    const related = relatedItems(ITEMS, ID(0), 'perfumes', 4);
    expect(related.map((item) => item.name)).toEqual([
      'Body Splash Pele de Seda 200 ml',
      'Dermapen Pro Sem Fio',
      'Jaleco Premium Bordado',
      'Camiseta Oversized Rede Demo',
    ]);
  });
});
