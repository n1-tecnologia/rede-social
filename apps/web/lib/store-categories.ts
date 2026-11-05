import {
  STORE_PRODUCT_CATEGORIES,
  type StoreProductCategory,
} from '@rede-social/module-store/contracts';

/**
 * The store's categories (2026-10-27, the product owner: "será vendido curso, livro, roupa,
 * perfumes, equipamentos e afins"): the storefront's tiles and shelves, in this order. The slug is
 * the `?categoria=` of the category's page.
 */
export const STORE_CATEGORIES = STORE_PRODUCT_CATEGORIES;
export type StoreCategory = StoreProductCategory;

export function isStoreCategory(value: unknown): value is StoreCategory {
  return typeof value === 'string' && (STORE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * ⚠ Until the API carries a category (`productCardSchema.category`, listed in the PDF of backend
 * needs), the storefront tells it from the product's NAME: the first kind whose words appear in it,
 * in THIS order (a book before a consultation, an equipment or a course before a service), else
 * "outros". Accents and case do not count, and only whole words match ("led", never "ledger").
 */
const CATEGORY_WORDS: ReadonlyArray<readonly [StoreCategory, readonly string[]]> = [
  ['livros', ['livro', 'livros', 'e-book', 'ebook', 'e-books', 'apostila', 'guia', 'manual']],
  [
    'materiais',
    [
      'protocolo',
      'protocolos',
      'planilha',
      'planilhas',
      'template',
      'templates',
      'checklist',
      'material',
      'materiais',
      'roteiro',
      'roteiros',
    ],
  ],
  [
    'roupas',
    [
      'camiseta',
      'camisetas',
      'camisa',
      'moletom',
      'jaqueta',
      'jaleco',
      'bone',
      'calca',
      'vestido',
      'blusa',
      'uniforme',
      'avental',
      'regata',
      'roupa',
      'roupas',
      'touca',
      'scrub',
      'casaco',
    ],
  ],
  [
    'perfumes',
    ['perfume', 'perfumes', 'fragrancia', 'colonia', 'body splash', 'eau de parfum', 'essencia'],
  ],
  [
    'equipamentos',
    [
      'equipamento',
      'equipamentos',
      'aparelho',
      'dermapen',
      'caneta',
      'maquina',
      'maca',
      'led',
      'laser',
      'ultrassom',
      'ring light',
      'luminaria',
      'tripe',
      'ponteira',
      'ponteiras',
    ],
  ],
  [
    'cursos',
    [
      'curso',
      'cursos',
      'formacao',
      'masterclass',
      'aula',
      'aulas',
      'treinamento',
      'workshop',
      'imersao',
      'webinar',
    ],
  ],
  [
    'servicos',
    ['mentoria', 'consultoria', 'sessao', 'sessoes', 'consulta', 'atendimento', 'pacote'],
  ],
];

/** Lower case, no accents: "Fragrância" → "fragrancia" (the guess and the search). */
export function plainText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// The words are plain letters, spaces and hyphens: nothing to escape in the pattern.
const MATCHERS = CATEGORY_WORDS.map(([category, words]) => ({
  category,
  pattern: new RegExp(`(^|[^a-z0-9])(${words.join('|')})(?=$|[^a-z0-9])`),
}));

/** The category a product's name tells (the temporary rule above). */
export function guessStoreCategory(name: string): StoreCategory {
  const text = plainText(name);
  return MATCHERS.find(({ pattern }) => pattern.test(text))?.category ?? 'outros';
}

/** The product's category: the API's when it sends one, else the name's (the temporary rule). */
export function productCategory(product: {
  name: string;
  category?: StoreCategory | undefined;
}): StoreCategory {
  return product.category ?? guessStoreCategory(product.name);
}
