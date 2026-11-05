import { describe, expect, it } from 'vitest';
import { guessStoreCategory, isStoreCategory, productCategory } from './store-categories';

/**
 * 2026-10-27 — the storefront's categories. Until the API carries one, the category comes from the
 * product's name (the temporary rule): pinned on the demo store's own names, the order between kinds
 * that share a word, accents and case, and whole words only.
 */

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

describe('productCategory', () => {
  it("the API's category wins over the name once it arrives", () => {
    expect(productCategory({ name: 'Perfume Signature', category: 'outros' })).toBe('outros');
    expect(productCategory({ name: 'Perfume Signature' })).toBe('perfumes');
  });
});

describe('isStoreCategory', () => {
  it('knows the eight slugs and nothing else', () => {
    expect(isStoreCategory('roupas')).toBe(true);
    expect(isStoreCategory('Roupas')).toBe(false);
    expect(isStoreCategory(undefined)).toBe(false);
  });
});
