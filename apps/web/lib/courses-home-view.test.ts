import { fileURLToPath } from 'node:url';
import type { Bootstrap } from '@rede-social/contracts';
import type {
  LearnCategoryTile,
  LearnCourseCard,
  LearnMyProgress,
  LearnTrack,
} from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  firstName,
  greetingPeriod,
  homeAreasView,
  homeGreetingView,
  homePromoView,
  homeResumeSpotView,
  homeStatsView,
  homeTrackCards,
  popularCategories,
  quickCourses,
  quickCourseView,
  trackCardsView,
} from './courses-home-view';
import { type HomeHeroView, trackDetailView } from './courses-member-view';
import { promoWithProduct } from './home-promo';

/**
 * 2026-10-26 — Início's view builders on the academy reference (the greeting by the school's hour,
 * "Populares:", the quick-access courses, the numbers strip, the tracks row, the school's areas and
 * the panel's promotion). Words come from the real pt-BR catalog; every number is the server's.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof homeStatsView>[1];

const SP = 'America/Sao_Paulo';

function card(id: string, overrides: Partial<LearnCourseCard> = {}): LearnCourseCard {
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

function track(id: string, overrides: Partial<LearnTrack> = {}): LearnTrack {
  return {
    id,
    title: `Trilha ${id}`,
    coverAssetId: null,
    percent: 0,
    coursesDone: 0,
    total: 2,
    currentIndex: 1,
    lessonCount: 12,
    durationSeconds: 7200,
    resumeCourseId: '11111111-1111-4111-8111-111111111111',
    mine: false,
    suggested: false,
    courses: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Primeiro passo',
        coverAssetId: null,
        state: 'a_seguir',
        locked: false,
        lessonCount: 6,
        durationSeconds: 3600,
        done: 0,
        percent: 0,
      },
    ],
    ...overrides,
  };
}

describe('the greeting (the school hour, never the browser)', () => {
  it('morning from 05:00, afternoon from 12:00, evening from 18:00 until 04:59, in the tenant zone', () => {
    // 15:00Z is noon in São Paulo (UTC−3).
    expect(greetingPeriod('2026-10-26T15:00:00.000Z', SP)).toBe('afternoon');
    expect(greetingPeriod('2026-10-26T14:59:00.000Z', SP)).toBe('morning');
    expect(greetingPeriod('2026-10-26T08:00:00.000Z', SP)).toBe('morning');
    expect(greetingPeriod('2026-10-26T07:59:00.000Z', SP)).toBe('evening');
    expect(greetingPeriod('2026-10-26T21:00:00.000Z', SP)).toBe('evening');
    expect(greetingPeriod('not a date', SP)).toBe('evening');
  });

  it('the first word of the display name, else of the account name; never an e-mail', () => {
    expect(firstName('  Thiago Nascimento ')).toBe('Thiago');
    expect(firstName('', 'Maria Clara')).toBe('Maria');
    expect(firstName('ana@x.com', null)).toBeNull();
    expect(firstName(undefined, '   ')).toBeNull();
    expect(Array.from(firstName('A'.repeat(40)) ?? '')).toHaveLength(24);
  });

  it('"Boa tarde, Thiago!" and, without a name, "Boa noite!"', () => {
    const bootstrap = {
      user: { id: 'u', email: 'x@y.z', name: 'Thiago N' },
      membership: { profile: { displayName: 'Thiago N' } },
      tenant: { timezone: SP },
    } as unknown as Pick<Bootstrap, 'user' | 'membership' | 'tenant'>;
    expect(homeGreetingView(bootstrap, '2026-10-26T15:00:00.000Z', t).title).toBe(
      'Boa tarde, Thiago!',
    );
    const anonymous = {
      user: { id: 'u', email: 'x@y.z', name: '' },
      membership: { profile: { displayName: '' } },
      tenant: { timezone: SP },
    } as unknown as Pick<Bootstrap, 'user' | 'membership' | 'tenant'>;
    expect(homeGreetingView(anonymous, '2026-10-26T23:00:00.000Z', t).title).toBe('Boa noite!');
    expect(homeGreetingView(bootstrap, '2026-10-26T15:00:00.000Z', t).ask).toBe(
      'O que você quer aprender agora?',
    );
  });
});

describe('"Populares:" and the quick-access courses', () => {
  it('the five categories with the most courses, ties in the server order, to the filtered catalogue', () => {
    const tiles: LearnCategoryTile[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      name,
      count: index === 3 ? 9 : 1,
      coverAssetId: null,
    }));
    const popular = popularCategories(tiles, true);
    expect(popular.map((chip) => chip.name)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(popular[0]?.href).toBe(
      '/area-membros/cursos?categoria=00000000-0000-4000-8000-000000000003&ver=aluno',
    );
    expect(popularCategories(undefined)).toEqual([]);
  });

  it('in progress first, then not started, then completed, each in the catalogue order', () => {
    const cards = [
      card('done', { completedCount: 10 }),
      card('fresh'),
      card('going', { completedCount: 3 }),
      card('fresh2'),
    ];
    expect(quickCourses(cards, 5).map((item) => item.id)).toEqual([
      'going',
      'fresh',
      'fresh2',
      'done',
    ]);
    expect(quickCourses(cards, 2)).toHaveLength(2);
  });

  it('a quick card: the share, its name and the lessons line for a screen reader', () => {
    const view = quickCourseView(card('c1', { completedCount: 3 }), t);
    expect(view.href).toBe('/cursos/c1');
    expect(view.percent).toBe(30);
    expect(view.percentLabel).toBe('30% concluído');
    expect(view.srLine).toBe('3/10 aulas');
    expect(view.ariaLabel).toContain('Curso c1');
    expect(quickCourseView(card('c1'), t, true).href).toBe('/cursos/c1?ver=aluno');
  });
});

describe('the numbers strip (the server numbers, display only)', () => {
  const progress: LearnMyProgress = {
    streakDays: 0,
    lessonsDone: 1,
    lessonsTotal: 1,
    percent: 100,
    secondsWatched: 0,
    coursesDone: 0,
    courses: [],
  };

  it('plural edges: "1 de 1 aula", "Concluída", and a zero streak without a nudge', () => {
    const view = homeStatsView(progress, t);
    expect(view.progress.value).toBe('100%');
    expect(view.progress.line).toBe('1 de 1 aula');
    expect(view.lessons.line).toBe('Concluída');
    expect(view.streak).toMatchObject({ value: '0', active: false });
    expect(view.streak.line).toBe('Sem sequência no momento');
    expect(view.courses.href).toBe('/area-membros/progresso');
  });

  it('zero lessons reads "Nenhuma concluída ainda"; a streak reads in days', () => {
    const view = homeStatsView({ ...progress, lessonsDone: 0, streakDays: 3 }, t);
    expect(view.lessons.line).toBe('Nenhuma concluída ainda');
    expect(view.streak).toMatchObject({ value: '3', active: true });
    expect(view.streak.line).toBe('Dias seguidos estudando');
  });
});

describe('the tracks row', () => {
  it("the member's own track first, its kind folded into the eyebrow; at most five", () => {
    const tracks = [
      track('t1'),
      track('t2', { mine: true, percent: 40, coursesDone: 1, currentIndex: 2 }),
      track('t3', { suggested: false }),
      track('t4'),
      track('t5'),
      track('t6'),
    ];
    const { cards, total } = homeTrackCards(tracks, undefined, t, false);
    expect(total).toBe(6);
    expect(cards.map((item) => item.id)).toEqual(['t2', 't1', 't3', 't4', 't5']);
    expect(cards[0]?.eyebrow).toBe('Sua trilha · 2 cursos');
    expect(cards[0]?.featured).toBe(true);
    expect(cards[0]?.percent).toBe(40);
    expect(cards[1]?.eyebrow).toBe('Trilha · 2 cursos');
    expect(cards[1]?.percent).toBeNull();
    expect(cards[1]?.href).toBe('/area-membros/trilhas?trilha=t1');
    expect(trackCardsView(tracks, t)).toHaveLength(6);
  });

  it('a suggested track says so; without the tracks read, the overview track alone', () => {
    const [suggested] = trackCardsView([track('t1', { suggested: true })], t);
    expect(suggested?.eyebrow).toBe('Trilha sugerida · 2 cursos');
    const fallback = homeTrackCards(
      null,
      {
        id: 't9',
        title: 'Trilha t9',
        coverAssetId: null,
        suggested: false,
        percent: 10,
        total: 3,
        coursesDone: 0,
        currentIndex: 1,
        currentCourseTitle: 'Primeiro passo',
        resumeCourseId: '11111111-1111-4111-8111-111111111111',
        lastLockedCourseTitle: null,
      },
      t,
    );
    expect(fallback.cards.map((item) => item.id)).toEqual(['t9']);
    expect(homeTrackCards(null, undefined, t).cards).toEqual([]);
    // The overview's track never carries the manager's words.
    expect(fallback.cards[0]).toMatchObject({ subtitle: null, audience: null });
  });

  // 2026-10-27: the manager's subtitle and audience, when the member read carries them.
  it("the manager's subtitle and audience, trimmed; blank or absent shows nothing", () => {
    const [full, blank, absent] = trackCardsView(
      [
        track('t1', { subtitle: '  Do básico ao avançado ', audience: 'Para quem está começando' }),
        track('t2', { subtitle: '   ', audience: '' }),
        track('t3'),
      ],
      t,
    );
    expect(full).toMatchObject({
      subtitle: 'Do básico ao avançado',
      audience: 'Para quem está começando',
    });
    expect(blank).toMatchObject({ subtitle: null, audience: null });
    expect(absent).toMatchObject({ subtitle: null, audience: null });
  });

  it("the track's page: the subtitle, the audience and the description, or nothing", () => {
    const page = trackDetailView(
      track('t1', {
        subtitle: 'Do básico ao avançado',
        audience: 'Para quem está começando',
        description: '  Uma trilha completa.  ',
      }),
      t,
    );
    expect(page).toMatchObject({
      subtitle: 'Do básico ao avançado',
      audience: 'Para quem está começando',
      description: 'Uma trilha completa.',
    });
    expect(trackDetailView(track('t2'), t)).toMatchObject({
      subtitle: null,
      audience: null,
      description: null,
    });
  });

  // 12.3-02 (UI-D-692, D-700): the member read now sends the three texts as strings, empty when the
  // admin wrote nothing; an empty or blank string is absent on the card and on the page alike.
  it('the empty and the whitespace-only string are absent on the card and on the page', () => {
    const empty = { subtitle: '', audience: '', description: '' };
    const blank = { subtitle: '  ', audience: ' \t', description: '\n ' };
    const cards = trackCardsView([track('t1', empty), track('t2', blank)], t);
    for (const card of cards) {
      expect(card).toMatchObject({ subtitle: null, audience: null });
    }
    for (const texts of [empty, blank]) {
      expect(trackDetailView(track('t3', texts), t)).toMatchObject({
        subtitle: null,
        audience: null,
        description: null,
      });
    }
  });

  it('a track with texts and one without lay out the same apart from the texts', () => {
    const [withTexts, without] = trackCardsView(
      [
        track('t1', { subtitle: 'Do básico', audience: 'Iniciantes' }),
        track('t1', { subtitle: '' }),
      ],
      t,
    );
    expect({ ...withTexts, subtitle: null, audience: null }).toEqual(without);
  });
});

describe("the school's areas and the panel's promotion", () => {
  it('Lives always, then the modules the tenant has on, with the menu labels', () => {
    const modules = [
      { key: 'store', nav: { label: 'Loja', icon: 'shopping-bag', href: '/loja', order: 5 } },
      {
        key: 'events',
        nav: { label: 'Agenda', icon: 'calendar-days', href: '/eventos', order: 40 },
      },
      { key: 'feed', nav: { label: 'Feed', icon: 'home', href: '/inicio', order: 1 } },
    ] as unknown as Bootstrap['modules'];
    const areas = homeAreasView(modules, t, true);
    expect(areas.map((area) => area.key)).toEqual(['lives', 'events', 'store']);
    expect(areas[0]?.href).toBe('/area-membros/lives?ver=aluno');
    expect(areas[1]?.title).toBe('Agenda');
  });

  it('a product the member does not hold: its name, its price and its page', () => {
    const view = homePromoView({
      product: { id: 'p1', name: 'Formação X', price: 'R$ 97,00' },
      productImages: ['img-1', null, 'img-1'],
      courseCovers: ['cover-1', null],
      courseCount: 5,
      trackCount: 2,
      tenant: 'Escola Demo',
      t,
    });
    expect(view.kind).toBe('product');
    expect(view.title).toBe('Formação X');
    expect(view.chips).toEqual(['R$ 97,00']);
    expect(view.cta.href).toBe('/loja/p1');
    expect(view.body).toBe('Disponível agora na loja de Escola Demo.');
    expect(view.images).toEqual(['img-1', 'cover-1']);
  });

  it('else the catalogue: how many courses and tracks, and the way to Cursos', () => {
    const view = homePromoView({
      product: null,
      productImages: [],
      courseCovers: [],
      courseCount: 1,
      trackCount: 0,
      tenant: 'Escola Demo',
      t,
      preview: true,
    });
    expect(view.kind).toBe('catalogue');
    expect(view.eyebrow).toBe('Catálogo de Escola Demo');
    expect(view.chips).toEqual(['1 curso']);
    expect(view.cta.href).toBe('/area-membros/cursos?ver=aluno');
  });

  it("the administrator's pick is drawn exactly as the server draws that product", () => {
    const base = {
      productImages: ['img-1', 'img-2'],
      courseCovers: ['cover-1'],
      courseCount: 3,
      trackCount: 1,
      tenant: 'Escola Demo',
      t,
    };
    const newest = { id: 'p-new', name: 'Formação X', price: 'R$ 97,00' };
    const picked = { id: 'p-old', name: 'Mentoria Y', price: 'Grátis' };
    expect(promoWithProduct(homePromoView({ ...base, product: newest }), picked)).toEqual(
      homePromoView({ ...base, product: picked }),
    );
  });
});

/**
 * 2026-10-27 — "Continue de onde parou" at the top of Início: the server's `retomando` hero with the
 * member's own minute in the lesson (`lastPositionSeconds` of the course's outline) as a bar.
 */
describe('homeResumeSpotView', () => {
  const hero: HomeHeroView = {
    sectionTitle: 'Continue de onde parou',
    eyebrow: 'Curso X · Módulo 01 · Aula 02',
    title: 'Aula dois',
    subLine: null,
    bar: null,
    progressLine: '',
    cta: { label: 'Continuar aula', href: '/cursos/c1/aulas/l2', play: true },
    coverAssetId: 'cover-1',
    badge: null,
    duration: '25:00',
  };

  it('the minute the member stopped at: the bar, its words and the way to the player', () => {
    const view = homeResumeSpotView(hero, { lastPositionSeconds: 754, durationSeconds: 1500 }, t);
    expect(view.watched).toEqual({
      percent: 50,
      line: 'Você parou em 12:34 de 25:00',
      label: '50% da aula assistida',
    });
    expect(view).toMatchObject({
      heading: 'Continue de onde parou',
      eyebrow: 'Curso X · Módulo 01 · Aula 02',
      title: 'Aula dois',
      coverAssetId: 'cover-1',
      cta: { label: 'Continuar aula', href: '/cursos/c1/aulas/l2' },
    });
  });

  it('a lesson not started yet reads "Próxima aula" over an empty bar', () => {
    const view = homeResumeSpotView(hero, { lastPositionSeconds: 0, durationSeconds: 1500 }, t);
    expect(view.watched).toEqual({
      percent: 0,
      line: 'Próxima aula · 25:00',
      label: '0% da aula assistida',
    });
  });

  it('hours on long videos, never past the end, and no bar without a length or an outline', () => {
    expect(
      homeResumeSpotView(hero, { lastPositionSeconds: 3725, durationSeconds: 7200 }, t).watched
        ?.line,
    ).toBe('Você parou em 1:02:05 de 2:00:00');
    expect(
      homeResumeSpotView(hero, { lastPositionSeconds: 9999, durationSeconds: 1500 }, t).watched,
    ).toMatchObject({ percent: 100, line: 'Você parou em 25:00 de 25:00' });
    expect(
      homeResumeSpotView(hero, { lastPositionSeconds: 30, durationSeconds: null }, t).watched,
    ).toBeNull();
    expect(homeResumeSpotView(hero, null, t).watched).toBeNull();
  });
});
