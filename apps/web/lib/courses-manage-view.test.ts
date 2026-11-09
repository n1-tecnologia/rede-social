import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import { manageCardsView } from './courses-manage-view';

/**
 * 2026-10-23 — the "Gerenciar" hub's cards, against the REAL pt-BR catalog: where each leads, its
 * icon, its words and its numbers line (the ICU plurals at 0, 1 and many). A failed read loses the
 * numbers line only, never the card.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof manageCardsView>[1];

describe('manageCardsView', () => {
  it('draws the four cards in the hub order, each to its management list', () => {
    const cards = manageCardsView(
      {
        courses: { courses: 9, modules: 28, lessons: 111 },
        tracks: 3,
        lives: { upcoming: 2, past: 5 },
        categories: 4,
      },
      t,
    );
    expect(cards.map((card) => [card.key, card.href, card.icon, card.title])).toEqual([
      ['courses', '/cursos', 'graduation-cap', 'Cursos'],
      ['tracks', '/cursos/trilhas', 'route', 'Trilhas'],
      ['lives', '/cursos/lives', 'radio', 'Lives'],
      ['categories', '/cursos/categorias', 'tag', 'Categorias'],
    ]);
    expect(cards.map((card) => card.meta)).toEqual([
      '9 cursos · 28 módulos · 111 aulas',
      '3 trilhas',
      '2 próximas · 5 passadas',
      '4 categorias',
    ]);
    expect(cards.map((card) => card.body)).toEqual([
      'A página do curso inteira: capa, textos, módulos, aulas, vídeos e materiais.',
      'Capa, título, público e a ordem dos cursos.',
      'Data, hora, duração, capa, acesso e o replay de cada uma.',
      'Nome e capa das categorias do catálogo.',
    ]);
  });

  it('words one in the singular and zero in the plural', () => {
    const one = manageCardsView(
      {
        courses: { courses: 1, modules: 1, lessons: 1 },
        tracks: 1,
        lives: { upcoming: 1, past: 1 },
        categories: 1,
      },
      t,
    );
    expect(one.map((card) => card.meta)).toEqual([
      '1 curso · 1 módulo · 1 aula',
      '1 trilha',
      '1 próxima · 1 passada',
      '1 categoria',
    ]);
    const zero = manageCardsView(
      {
        courses: { courses: 0, modules: 0, lessons: 0 },
        tracks: 0,
        lives: { upcoming: 0, past: 0 },
        categories: 0,
      },
      t,
    );
    expect(zero.map((card) => card.meta)).toEqual([
      '0 cursos · 0 módulos · 0 aulas',
      '0 trilhas',
      '0 próximas · 0 passadas',
      '0 categorias',
    ]);
  });

  it('a failed read keeps the card and drops only its numbers line', () => {
    const cards = manageCardsView(
      { courses: null, tracks: null, lives: null, categories: null },
      t,
    );
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.meta)).toEqual([null, null, null, null]);
    expect(cards.every((card) => card.title !== '' && card.body !== '')).toBe(true);
  });
});
