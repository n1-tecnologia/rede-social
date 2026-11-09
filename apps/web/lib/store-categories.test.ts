import { fileURLToPath } from 'node:url';
import {
  STORE_BUILT_IN_CATEGORIES,
  STORE_CATEGORY_NAME_MAX,
} from '@rede-social/module-store/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  builtInCategories,
  cleanCategoryName,
  guessStoreCategory,
  isStoreCategory,
  storeCategoryIds,
  storeCategoryList,
} from './store-categories';

/**
 * 2026-10-27 — the storefront's categories. The name guess is the contract's one rule (it only
 * pre-selects the product form's field, 12.3 D-692): pinned on the demo store's own names, the order
 * between kinds that share a word, accents and case, and whole words only.
 *
 * 12.3-13 (D-695, UI-D-687): the surviving pure helpers of the retired per-device cookie, now fed by
 * the API's category list (`GET /v1/store/front`).
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof storeCategoryList>[1];

describe('guessStoreCategory', () => {
  it('reads the demo store the way the storefront shelves it', () => {
    const shelves: Record<string, string> = {
      'Formação Marketing para Clínicas': 'cursos',
      'Masterclass Lábios Naturais': 'cursos',
      'E-book: Primeira Consulta': 'livros',
      'Livro: Harmonização Facial na Prática': 'livros',
      'Guia de Precificação para Clínicas': 'livros',
      'Kit de Protocolos de Bioestimuladores': 'materiais',
      'Jaleco Premium Bordado': 'roupas',
      'Camiseta Oversized Rede Demo': 'roupas',
      'Boné Aba Curva Rede Demo': 'roupas',
      'Perfume Signature 100 ml': 'perfumes',
      'Body Splash Pele de Seda 200 ml': 'perfumes',
      'Dermapen Pro Sem Fio': 'equipamentos',
      'Luminária LED de Bancada': 'equipamentos',
      'Ring Light Profissional 18 polegadas': 'equipamentos',
      'Mentoria Individual: Agenda Cheia': 'servicos',
      'Pacote Skinbooster: 3 Sessões': 'servicos',
    };
    for (const [name, category] of Object.entries(shelves)) {
      expect([name, guessStoreCategory(name)]).toEqual([name, category]);
    }
  });

  it('a kind earlier in the order wins a shared word', () => {
    // A book before a consultation, an equipment before a service, a course before a service.
    expect(guessStoreCategory('E-book: Primeira Consulta')).toBe('livros');
    expect(guessStoreCategory('Kit Ring Light para Atendimento')).toBe('equipamentos');
    expect(guessStoreCategory('Curso de Atendimento ao Paciente')).toBe('cursos');
  });

  it('accents and case do not count; only whole words match', () => {
    expect(guessStoreCategory('FRAGRÂNCIA AMADEIRADA')).toBe('perfumes');
    expect(guessStoreCategory('ebook de receitas')).toBe('livros');
    expect(guessStoreCategory('Ledger de vendas')).toBe('outros');
    expect(guessStoreCategory('Cursinho')).toBe('outros');
  });

  it('anything else is "outros"', () => {
    expect(guessStoreCategory('Vale-presente')).toBe('outros');
    expect(guessStoreCategory('')).toBe('outros');
  });
});

describe('the API list as the screens read it', () => {
  const api = [
    { id: 'livros', name: 'Livros', icon: 'book-open' as const },
    { id: 'roupas', name: 'Vestuário', icon: 'shirt' as const },
    { id: 'skincare', name: 'Skincare', icon: 'sparkles' as const },
  ];

  it('the ids keep the store order, and a failed or missing front has none', () => {
    expect(
      storeCategoryIds({ categories: api, promoProductId: null, featuredProductIds: [] }),
    ).toEqual(['livros', 'roupas', 'skincare']);
    expect(storeCategoryIds(null)).toEqual([]);
    expect(
      storeCategoryIds({ categories: [], promoProductId: null, featuredProductIds: [] }),
    ).toEqual([]);
  });

  it("the chip's singular tag keeps the shipped rule: a built-in slug with its default name only", () => {
    expect(storeCategoryList(api, t).map((category) => [category.id, category.tag])).toEqual([
      ['livros', 'Livro'],
      ['roupas', 'Vestuário'],
      ['skincare', 'Skincare'],
    ]);
  });

  it('is empty for an empty list (no category left, the admin deleted them all)', () => {
    expect(storeCategoryList([], t)).toEqual([]);
  });
});

describe('the built-in eight (what "Restaurar as categorias padrão" returns to)', () => {
  it("are the contract's own rows, with their own slugs, in the storefront's order", () => {
    const eight = builtInCategories();
    expect(eight).toHaveLength(8);
    expect(eight.map((category) => category.id)).toEqual(
      STORE_BUILT_IN_CATEGORIES.map((category) => category.slug),
    );
    expect(eight[0]).toEqual({ id: 'cursos', name: 'Cursos', icon: 'graduation-cap' });
  });
});

describe("the contract's name rule the sheet uses", () => {
  it('count a name in code points, not UTF-16 units (an emoji is one character)', () => {
    const emoji = '😀'.repeat(STORE_CATEGORY_NAME_MAX + 5);
    expect(Array.from(cleanCategoryName(emoji))).toHaveLength(STORE_CATEGORY_NAME_MAX);
    expect(cleanCategoryName('  Skin   care  ')).toBe('Skin care');
  });
});

describe('isStoreCategory', () => {
  it('knows the eight slugs and nothing else', () => {
    expect(isStoreCategory('roupas')).toBe(true);
    expect(isStoreCategory('Roupas')).toBe(false);
    expect(isStoreCategory(undefined)).toBe(false);
  });
});
