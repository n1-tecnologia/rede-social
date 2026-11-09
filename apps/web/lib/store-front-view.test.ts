import { fileURLToPath } from 'node:url';
import {
  type ProductCard,
  STORE_BUILT_IN_CATEGORIES,
  type StoreFront,
} from '@rede-social/module-store/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import { storeCategoryList } from './store-categories';
import {
  parseStoreQuery,
  relatedItems,
  storeFrontContext,
  storeFrontView,
  storeHref,
  storeItems,
  storeListingView,
} from './store-front-view';

/**
 * 2026-10-27 — the storefront's view (the product owner: "cards maiores, destaque em itens, esquema
 * de prateleiras de itens, categorias"): the hero, the category tiles, a shelf per category, a
 * category's page and the search with their orders. Words from the real pt-BR catalog.
 *
 * 12.3-13 (D-693, D-699, UI-D-690): the categories, the featured ids and the promo are the API's
 * (`GET /v1/store/front`) and each product's category is the slug the API sent: the web never
 * guesses one, and a failed front call degrades to the products alone.
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
  category: string | undefined,
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
    ...(category === undefined ? {} : { category }),
    ...overrides,
  };
}

// The API's order: newest first; the category is the one the API sent.
const PRODUCTS = [
  product('Perfume Signature 100 ml', 32900, 'perfumes'),
  product('Dermapen Pro Sem Fio', 189000, 'equipamentos'),
  product('Jaleco Premium Bordado', 24900, 'roupas'),
  product('Body Splash Pele de Seda 200 ml', 7990, 'perfumes'),
  product('Camiseta Oversized Rede Demo', 8990, 'roupas'),
  product('Boné Aba Curva Rede Demo', 6990, 'roupas'),
  product('E-book: Primeira Consulta', 0, 'livros', { owned: true }),
];
const BUILT_IN = STORE_BUILT_IN_CATEGORIES.map(({ slug, name, icon }) => ({
  id: slug,
  name,
  icon,
}));
const CATEGORIES = storeCategoryList(BUILT_IN, t);
const IDS = CATEGORIES.map((category) => category.id);
const ITEMS = storeItems(PRODUCTS, t, { categories: CATEGORIES });
const ID = (index: number) => PRODUCTS[index]?.id ?? '';

describe('storeItems', () => {
  it('each product with the category the API sent, its chip and its price', () => {
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

  it('never guesses: a product the API gave no category sits in no shelf, whatever its name says', () => {
    // "Perfume Signature" would be guessed as perfumes by the old name rule.
    const items = storeItems(
      [product('Perfume Signature 100 ml', 32900, undefined), PRODUCTS[1] as ProductCard],
      t,
      { categories: CATEGORIES },
    );
    expect(items.map((item) => [item.category, item.tag])).toEqual([
      [null, ''],
      ['equipamentos', 'Equipamento'],
    ]);
    const view = storeFrontView(items, t, { categories: CATEGORIES });
    expect(view.shelves.map((shelf) => shelf.key)).toEqual(['equipamentos']);
    expect(view.shelves[0]?.items.map((item) => item.name)).toEqual(['Dermapen Pro Sem Fio']);
  });

  it('a category the store no longer keeps (a stale slug) reads as none', () => {
    const [item] = storeItems([product('Vela', 1000, 'aromas')], t, { categories: CATEGORIES });
    expect(item?.category).toBeNull();
    expect(item?.tag).toBe('');
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
    // Every category keeps its chip, in the store's order; the ones with no product say so.
    expect(view.categories.map((tile) => [tile.key, tile.count, tile.href])).toEqual([
      ['cursos', 'Nenhum produto', '/loja?categoria=cursos'],
      ['livros', '1 produto', '/loja?categoria=livros'],
      ['materiais', 'Nenhum produto', '/loja?categoria=materiais'],
      ['roupas', '3 produtos', '/loja?categoria=roupas'],
      ['perfumes', '2 produtos', '/loja?categoria=perfumes'],
      ['equipamentos', '1 produto', '/loja?categoria=equipamentos'],
      ['servicos', 'Nenhum produto', '/loja?categoria=servicos'],
      ['outros', 'Nenhum produto', '/loja?categoria=outros'],
    ]);
    expect(view.categories[3]?.ariaLabel).toBe('Roupas, 3 produtos');
    // An empty shelf is not drawn.
    expect(view.shelves.map((shelf) => shelf.key)).toEqual([
      'livros',
      'roupas',
      'perfumes',
      'equipamentos',
    ]);
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
    // An id that is not for sale any more is dropped silently and the newest take its place.
    expect(
      storeFrontView(ITEMS, t, { categories: CATEGORIES, featured: ['gone'] }).hero?.main.name,
    ).toBe('Perfume Signature 100 ml');
  });

  it('the featured list in its order: the first large, the others beside it, then the newest up to five', () => {
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

  it("the store's own categories: its names, glyphs and order", () => {
    const categories = storeCategoryList(
      [
        { id: 'skincare', name: 'Skincare', icon: 'sparkles' },
        { id: 'roupas', name: 'Vestuário', icon: 'shirt' },
        { id: 'perfumes', name: 'Perfumes', icon: 'spray-can' },
      ],
      t,
    );
    const items = storeItems(
      [
        product('Sérum', 9000, 'skincare'),
        product('Jaleco', 24900, 'roupas'),
        product('Camiseta', 8990, 'roupas'),
        product('Colônia', 7990, 'perfumes'),
        product('Sem categoria', 100, undefined),
      ],
      t,
      { categories },
    );
    expect(items.map((item) => [item.category, item.tag])).toEqual([
      ['skincare', 'Skincare'],
      ['roupas', 'Vestuário'],
      ['roupas', 'Vestuário'],
      ['perfumes', 'Perfume'],
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
  });

  it('an empty store has no hero, no tile of products and no shelf', () => {
    const view = storeFrontView([], t, { categories: CATEGORIES });
    expect(view.hero).toBeNull();
    expect(view.shelves).toEqual([]);
  });
});

describe('storeFrontContext', () => {
  const front = (over: Partial<StoreFront> = {}): StoreFront => ({
    categories: BUILT_IN,
    promoProductId: null,
    featuredProductIds: [],
    ...over,
  });

  it("reads the API's categories and featured ids; a saved featured list leads over the promo", () => {
    const context = storeFrontContext(
      front({ featuredProductIds: [ID(1), ID(2)], promoProductId: ID(3) }),
      t,
    );
    expect(context.categories.map((category) => category.id)).toEqual(IDS);
    expect(context.featured).toEqual([ID(1), ID(2)]);
    expect(context.plain).toBe(false);
  });

  it('with no featured list the promo product leads the hero; with neither, the newest do', () => {
    expect(storeFrontContext(front({ promoProductId: ID(3) }), t).featured).toEqual([ID(3)]);
    expect(storeFrontContext(front(), t).featured).toEqual([]);
  });

  it('a failed front call is the products alone: no chips, no hero, newest first', () => {
    const context = storeFrontContext(null, t);
    expect(context).toEqual({ categories: [], featured: [], plain: true });
  });

  it('with no category left there are no chips and the whole catalogue shows as the grid', () => {
    const context = storeFrontContext(front({ categories: [] }), t);
    expect(context.categories).toEqual([]);
    expect(context.plain).toBe(true);
  });

  it('an unknown ?categoria= slug means all, with or without a front', () => {
    const ids = (value: StoreFront | null) =>
      storeFrontContext(value, t).categories.map((category) => category.id);
    expect(parseStoreQuery({ categoria: 'carros' }, ids(front())).categoria).toBeNull();
    expect(parseStoreQuery({ categoria: 'livros' }, ids(null)).categoria).toBeNull();
    expect(parseStoreQuery({ categoria: 'livros' }, ids(front())).categoria).toBe('livros');
  });

  it('a category with no product keeps its chip at 0 and its page opens empty', () => {
    const view = storeFrontView(ITEMS, t, storeFrontContext(front(), t));
    expect(view.categories.find((tile) => tile.key === 'cursos')?.count).toBe('Nenhum produto');
    const listing = storeListingView(
      ITEMS,
      parseStoreQuery({ categoria: 'cursos' }, IDS),
      t,
      CATEGORIES,
    );
    expect(listing.items).toEqual([]);
    expect(listing.sub).toBe('Nenhum produto');
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
