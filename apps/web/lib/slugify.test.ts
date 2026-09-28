import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify (D-31 slug suggestion)', () => {
  it('strips accents and joins words with hyphens', () => {
    expect(slugify('Associação São José')).toBe('associacao-sao-jose');
  });

  it('collapses punctuation and surrounding whitespace', () => {
    expect(slugify('  Rede  Demo!! ')).toBe('rede-demo');
  });

  it('cuts at 40 characters without a trailing hyphen', () => {
    const long = 'Instituto Horizonte de Formação Continuada e Pesquisa Aplicada';
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps the base letters of combining characters', () => {
    expect(slugify('ção')).toBe('cao');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('---')).toBe('');
  });
});
