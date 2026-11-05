import { fileURLToPath } from 'node:url';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { LearnCourseCard } from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import { feedSuggestionsView, suggestedCourses } from './feed-suggestions-view';

/**
 * 2026-10-26 — the feed's suggestions column: which courses and communities it shows, in which
 * order, and the words of each tile. Words come from the real pt-BR catalog.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof feedSuggestionsView>[0]['t'];

function course(id: string, overrides: Partial<LearnCourseCard> = {}): LearnCourseCard {
  return {
    id,
    title: `Curso ${id}`,
    coverAssetId: null,
    category: null,
    level: null,
    lessonCount: 10,
    durationSeconds: 3600,
    completedCount: 0,
    locked: false,
    ...overrides,
  };
}

function community(id: string, overrides: Partial<CommunitySummary> = {}): CommunitySummary {
  return {
    id,
    name: `Comunidade ${id}`,
    slug: id,
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 2,
    status: 'active',
    lastActivityAt: '2026-10-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('the courses worth suggesting', () => {
  it('open and unfinished only, the ones in progress first, then the catalogue order', () => {
    const cards = [
      course('fresh'),
      course('done', { completedCount: 10 }),
      course('locked', { locked: true }),
      course('going', { completedCount: 3 }),
      course('fresh2'),
    ];
    expect(suggestedCourses(cards, 5).map((card) => card.id)).toEqual(['going', 'fresh', 'fresh2']);
    expect(suggestedCourses(cards, 2)).toHaveLength(2);
  });
});

describe('the column', () => {
  it('the first course is the large tile, then a community and a course in turn, five at most', () => {
    const view = feedSuggestionsView({
      courses: [course('c1', { completedCount: 3 }), course('c2'), course('c3'), course('c4')],
      communities: [community('m1'), community('m2'), community('m3')],
      preview: false,
      t,
    });
    expect(view?.title).toBe('Sugestões para você');
    expect(view?.tiles.map((tile) => tile.key)).toEqual([
      'course:c1',
      'community:m1',
      'course:c2',
      'community:m2',
      'course:c3',
    ]);
    const [going, club, fresh] = view?.tiles ?? [];
    expect(going).toMatchObject({
      href: '/cursos/c1',
      eyebrow: 'Curso · Em andamento',
      line: '3 de 10 aulas',
      percent: 30,
      cta: 'Continuar',
    });
    expect(club).toMatchObject({
      href: '/comunidades/m1',
      eyebrow: 'Comunidade',
      line: '2 publicações',
      percent: null,
      cta: 'Acessar',
    });
    expect(fresh).toMatchObject({ eyebrow: 'Curso', line: '10 aulas', percent: null });
    expect(view?.links).toEqual([
      { href: '/area-membros/cursos', label: 'Todos os cursos' },
      { href: '/comunidades', label: 'Todas as comunidades' },
    ]);
  });

  it('one kind fills the rest when the other runs out; a manager opens the member course page', () => {
    const view = feedSuggestionsView({
      courses: [course('c1')],
      communities: [community('m1'), community('m2'), community('m3'), community('m4')],
      preview: true,
      t,
    });
    expect(view?.tiles.map((tile) => tile.key)).toEqual([
      'course:c1',
      'community:m1',
      'community:m2',
      'community:m3',
      'community:m4',
    ]);
    expect(view?.tiles[0]?.href).toBe('/cursos/c1?ver=aluno');
    expect(view?.links[0]?.href).toBe('/area-membros/cursos?ver=aluno');
  });

  it('without courses a community leads; an archived one never shows; plural edges', () => {
    const view = feedSuggestionsView({
      courses: null,
      communities: [
        community('gone', { status: 'archived' }),
        community('m1', { postCount: 0 }),
        community('m2', { postCount: 1 }),
      ],
      preview: false,
      t,
    });
    expect(view?.tiles.map((tile) => tile.key)).toEqual(['community:m1', 'community:m2']);
    expect(view?.tiles[0]?.line).toBe('Nenhuma publicação ainda');
    expect(view?.tiles[1]?.line).toBe('1 publicação');
    expect(view?.links).toEqual([{ href: '/comunidades', label: 'Todas as comunidades' }]);
  });

  it('nothing to suggest is no column', () => {
    expect(feedSuggestionsView({ courses: null, communities: null, preview: false, t })).toBeNull();
    expect(
      feedSuggestionsView({
        courses: [course('done', { completedCount: 10 })],
        communities: [],
        preview: false,
        t,
      }),
    ).toBeNull();
    const empty = feedSuggestionsView({
      courses: [course('c0', { lessonCount: 0 })],
      communities: null,
      preview: false,
      t,
    });
    expect(empty?.tiles[0]?.line).toBe('Sem aulas ainda');
  });
});
