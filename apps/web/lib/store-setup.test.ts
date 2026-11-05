import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  cleanCategoryName,
  EMPTY_STORE_SETUP,
  encodeAssignments,
  encodeStoreSetup,
  NO_CATEGORY,
  newCategoryId,
  parseAssignments,
  parseStoreSetup,
  productKey,
  STORE_CATEGORY_MAX,
  STORE_FEATURED_MAX,
  storeCategoryIds,
} from './store-setup';

/**
 * 2026-10-28 — the store's setup kept on the device (Gerenciar's categories and "Em destaque", the
 * product form's category): the two cookies' text both ways, and nothing malformed ever surviving a
 * read (a cookie is user input).
 */

const A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const B = '11111111-2222-4333-8444-555555555555';

/** A cookie's base64 of a JSON text, encoded as UTF-8 (the accents included). */
const b64 = (json: unknown) => Buffer.from(JSON.stringify(json), 'utf8').toString('base64');

describe('the setup cookie', () => {
  it('round-trips the categories (accents included) and the featured list', () => {
    const setup = {
      categories: [
        { id: 'skincare', name: 'Skincare', icon: 'sparkles' as const },
        { id: 'vestuario', name: 'Vestuário & Cia', icon: 'shirt' as const },
      ],
      featured: [B, A],
    };
    const text = encodeStoreSetup(setup);
    // Only cookie-safe characters: base64url.
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseStoreSetup(text)).toEqual(setup);
  });

  it('reads anything malformed as the built-in store', () => {
    expect(parseStoreSetup(undefined)).toEqual(EMPTY_STORE_SETUP);
    expect(parseStoreSetup('')).toEqual(EMPTY_STORE_SETUP);
    expect(parseStoreSetup('%%%')).toEqual(EMPTY_STORE_SETUP);
    expect(parseStoreSetup(Buffer.from('not json').toString('base64'))).toEqual(EMPTY_STORE_SETUP);
  });

  it('drops bad entries one by one: ids, empty names, duplicates, unknown glyphs, extra rows', () => {
    const raw = b64({
      c: [
        ['ok', '  Bem   espaçado  ', 'gem'],
        ['ok', 'Repetido', 'gem'],
        ['Maiúscula', 'Nome', 'gem'],
        ['vazio', '   ', 'gem'],
        ['glifo', 'Glifo', 'rocket'],
        ...Array.from({ length: 30 }, (_, n) => [`c${n}`, `Categoria ${n}`, 'tag']),
      ],
      f: [A, A.toUpperCase(), 'gone', B, ...Array.from({ length: 9 }, () => B)],
    });
    const setup = parseStoreSetup(raw);
    expect(setup.categories?.[0]).toEqual({ id: 'ok', name: 'Bem espaçado', icon: 'gem' });
    expect(setup.categories?.[1]).toEqual({ id: 'glifo', name: 'Glifo', icon: 'tag' });
    expect(setup.categories?.length).toBeLessThanOrEqual(STORE_CATEGORY_MAX);
    expect(setup.featured).toEqual([A, B]);
    expect(setup.featured.length).toBeLessThanOrEqual(STORE_FEATURED_MAX);
  });

  it('the built-in store keeps its eight ids; a custom one its own, in order', () => {
    expect(storeCategoryIds(EMPTY_STORE_SETUP)).toHaveLength(8);
    expect(
      storeCategoryIds({
        categories: [
          { id: 'b', name: 'B', icon: 'tag' },
          { id: 'a', name: 'A', icon: 'tag' },
        ],
        featured: [],
      }),
    ).toEqual(['b', 'a']);
  });
});

describe('the assignments cookie', () => {
  it('round-trips short keys, "no category" included, and drops bad pairs', () => {
    const map = new Map([
      [productKey(A), 'skincare'],
      [productKey(B), NO_CATEGORY],
    ]);
    const text = encodeAssignments(map);
    expect(text).toBe('9e0f1a2b3c4d~skincare.555555555555~_');
    expect(parseAssignments(text)).toEqual(map);
    expect(parseAssignments('zzz~a.0a1b2c3d4e5f~Ruim.0a1b2c3d4e5f')).toEqual(new Map());
  });
});

describe('names and ids', () => {
  it('cleans a name and makes a unique, readable id from it', () => {
    expect(cleanCategoryName('  Skin   care  ')).toBe('Skin care');
    expect(cleanCategoryName('x'.repeat(40))).toHaveLength(30);
    expect(newCategoryId('Skin Care & Cia', new Set())).toBe('skin-care-cia');
    expect(newCategoryId('Perfumes', new Set(['perfumes']))).toBe('perfumes-2');
    expect(newCategoryId('Perfumes', new Set(['perfumes', 'perfumes-2']))).toBe('perfumes-3');
    expect(newCategoryId('Àçã!', new Set())).toBe('aca');
    expect(newCategoryId('***', new Set())).toBe('categoria');
  });
});

describe('categoryOf', () => {
  const kept = [{ id: 'skincare' }, { id: 'roupas' }];

  it("the form's choice first, then the name's guess, each only while the store keeps it", () => {
    const product = { id: A, name: 'Camiseta Rede' };
    expect(categoryOf(product, kept, new Map())).toBe('roupas');
    expect(categoryOf(product, kept, new Map([[productKey(A), 'skincare']]))).toBe('skincare');
    // A choice of a removed category falls back to the guess; "Sem categoria" wins over it.
    expect(categoryOf(product, kept, new Map([[productKey(A), 'gone']]))).toBe('roupas');
    expect(categoryOf(product, kept, new Map([[productKey(A), NO_CATEGORY]]))).toBeNull();
    // A guess the store does not keep is no category.
    expect(categoryOf({ id: B, name: 'Livro de receitas' }, kept, new Map())).toBeNull();
  });
});
