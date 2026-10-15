import { fileURLToPath } from 'node:url';
import type { LearnCourseCard, LearnLiveCard } from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  catalogueCategoryHref,
  categoryFromParam,
  courseAccessById,
  courseCardTags,
  courseCardView,
  coursePercent,
  liveAccessById,
  liveCardView,
} from './courses-member-view';

/**
 * 08.5-06 — the member catalogue's view builders (UI-D-425, UI-D-426, D-421, D-430, E02/E03). Every
 * partial row of E03 is a case here: the card prints exactly what the API and the store said, and
 * the accessible name says exactly what the poster draws.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof courseCardView>[2];

const C = '11111111-1111-4111-8111-111111111111';
const K = '33333333-3333-4333-8333-333333333333';

function card(overrides: Partial<LearnCourseCard> = {}): LearnCourseCard {
  return {
    id: C,
    title: 'Lábios: técnica',
    coverAssetId: null,
    category: { id: K, name: 'Lábios' },
    level: 'iniciante',
    lessonCount: 6,
    durationSeconds: 45 * 60,
    completedCount: 0,
    locked: false,
    ...overrides,
  };
}

const LOCKED = { locked: true, archivedTag: false };

describe('categoryFromParam / catalogueCategoryHref (UI-D-425, E02 error)', () => {
  const chips = [{ id: K }];

  it('a listed id selects that category; anything else reads as "Todas"', () => {
    expect(categoryFromParam(K, chips)).toBe(K);
    expect(categoryFromParam('44444444-4444-4444-8444-444444444444', chips)).toBeNull();
    expect(categoryFromParam('labios', chips)).toBeNull();
    expect(categoryFromParam([K, K], chips)).toBeNull();
    expect(categoryFromParam(undefined, chips)).toBeNull();
    expect(categoryFromParam(K, [])).toBeNull();
  });

  it('"Todas" is /cursos, a category /cursos?categoria=, a preview keeps ?ver=aluno', () => {
    expect(catalogueCategoryHref(null)).toBe('/cursos');
    expect(catalogueCategoryHref(K)).toBe(`/cursos?categoria=${K}`);
    expect(catalogueCategoryHref(null, true)).toBe('/cursos?ver=aluno');
    expect(catalogueCategoryHref(K, true)).toBe(`/cursos?categoria=${K}&ver=aluno`);
  });
});

describe('courseCardView (UI-D-426, E03)', () => {
  it('populated: href, title, cover, the category · level line and the meta with duration', () => {
    const view = courseCardView(card({ coverAssetId: K }), undefined, t);
    expect(view).toMatchObject({
      id: C,
      href: `/cursos/${C}`,
      title: 'Lábios: técnica',
      coverAssetId: K,
      categoryLine: 'Lábios · Iniciante',
      meta: '6 aulas · 45 min',
      tags: { exclusive: false, archived: false },
      progress: null,
      ariaLabel: 'Lábios: técnica, 6 aulas',
    });
  });

  it('partial: no category → the level alone; no level → the category alone; neither → null', () => {
    expect(courseCardView(card({ category: null }), undefined, t).categoryLine).toBe('Iniciante');
    expect(courseCardView(card({ level: null }), undefined, t).categoryLine).toBe('Lábios');
    expect(
      courseCardView(card({ category: null, level: null }), undefined, t).categoryLine,
    ).toBeNull();
    expect(courseCardView(card({ level: 'avancado' }), undefined, t).categoryLine).toBe(
      'Lábios · Avançado',
    );
  });

  it('partial: zero duration → the meta omits it; the meta pluralises 1 aula / N aulas', () => {
    expect(courseCardView(card({ durationSeconds: 0 }), undefined, t).meta).toBe('6 aulas');
    expect(courseCardView(card({ lessonCount: 1, durationSeconds: 0 }), undefined, t).meta).toBe(
      '1 aula',
    );
    expect(
      courseCardView(card({ lessonCount: 18, durationSeconds: 2 * 3600 }), undefined, t).meta,
    ).toBe('18 aulas · 2 h');
  });

  it('partial: no completion → no bar; one completed lesson → the bar and its name (D-430)', () => {
    expect(courseCardView(card({ completedCount: 0 }), undefined, t).progress).toBeNull();
    const view = courseCardView(card({ completedCount: 2 }), undefined, t);
    expect(view.progress).toEqual({ percent: 33, label: '33% concluído' });
    expect(view.ariaLabel).toBe('Lábios: técnica, 6 aulas, 33% concluído');
  });

  it('A-UI-5: a LOCKED card keeps its bar once a free lesson is complete', () => {
    const view = courseCardView(card({ locked: true, completedCount: 1 }), LOCKED, t);
    expect(view.tags).toEqual({ exclusive: true, archived: false });
    expect(view.progress?.percent).toBe(16);
    expect(view.ariaLabel).toBe('Lábios: técnica, 6 aulas, exclusivo, 16% concluído');
  });

  it('tags come only from the store: locked → "Exclusivo"; archived rides under it', () => {
    expect(courseCardView(card(), LOCKED, t).ariaLabel).toBe('Lábios: técnica, 6 aulas, exclusivo');
    expect(courseCardView(card(), { locked: true, archivedTag: true }, t).tags).toEqual({
      exclusive: true,
      archived: true,
    });
  });

  it('E03 error / UI-D-442: a failed or store-off read (undefined) and an owner draw no tag', () => {
    // The courses API says locked, the store read failed: no tag, never a wrong one.
    expect(courseCardView(card({ locked: true }), undefined, t).tags).toEqual({
      exclusive: false,
      archived: false,
    });
    expect(courseCardTags(null)).toEqual({ exclusive: false, archived: false });
    expect(courseCardTags({ locked: false, archivedTag: true })).toEqual({
      exclusive: false,
      archived: false,
    });
  });

  it('a manager preview keeps ?ver=aluno on the card href; ids are encoded', () => {
    expect(courseCardView(card(), undefined, t, { preview: true }).href).toBe(
      `/cursos/${C}?ver=aluno`,
    );
  });

  it('long text passes through untouched (CSS clamps it, never a slice)', () => {
    const title = 'A'.repeat(120);
    expect(courseCardView(card({ title }), undefined, t).title).toBe(title);
  });
});

describe('coursePercent / courseAccessById', () => {
  it('floors, never exceeds 100 and is 0 for a course with no lesson', () => {
    expect(coursePercent(1, 3)).toBe(33);
    expect(coursePercent(2, 3)).toBe(66);
    expect(coursePercent(3, 3)).toBe(100);
    expect(coursePercent(5, 3)).toBe(100);
    expect(coursePercent(1, 0)).toBe(0);
  });

  it('keys the access list by course id; a null read stays null', () => {
    expect(courseAccessById(null)).toBeNull();
    const map = courseAccessById({
      items: [{ courseId: C, locked: true, gated: true, archivedTag: false }],
    });
    expect(map?.get(C)?.locked).toBe(true);
    expect(map?.get(K)).toBeUndefined();
  });
});

describe('liveCardView (UI-D-434, E04)', () => {
  const L = '55555555-5555-4555-8555-555555555555';
  const TZ = 'America/Sao_Paulo';

  function live(overrides: Partial<LearnLiveCard> = {}): LearnLiveCard {
    return {
      id: L,
      title: 'Tira-dúvidas de outubro',
      coverAssetId: null,
      // 2026-10-16 22:00Z → sex, 16 de out, 19:00 in São Paulo.
      startsAt: '2026-10-16T22:00:00.000Z',
      durationMin: 60,
      endsAt: '2026-10-16T23:00:00.000Z',
      status: 'scheduled',
      locked: false,
      hasReplay: false,
      ...overrides,
    };
  }

  it('the four statuses read in words; only the on-air one carries the Radio glyph', () => {
    const scheduled = liveCardView(live(), undefined, TZ, t);
    expect(scheduled.statusLabel).toBe('Agendada');
    expect(scheduled.statusIcon).toBeNull();
    const onAir = liveCardView(live({ status: 'live' }), undefined, TZ, t);
    expect(onAir.statusLabel).toBe('Ao vivo agora');
    expect(onAir.statusIcon).toBe('radio');
    expect(liveCardView(live({ status: 'recorded' }), undefined, TZ, t).statusLabel).toBe(
      'Gravada',
    );
    const cancelled = liveCardView(live({ status: 'cancelled' }), undefined, TZ, t);
    expect(cancelled.statusLabel).toBe('Cancelada');
    expect(cancelled.cancelled).toBe(true);
    expect(scheduled.cancelled).toBe(false);
  });

  it('the meta and the name carry the date and time in the TENANT timezone', () => {
    const view = liveCardView(live(), undefined, TZ, t);
    expect(view.meta).toBe('sex, 16 de out, 19:00 · 60 min');
    expect(view.ariaLabel).toBe('Tira-dúvidas de outubro, Agendada, sex, 16 de out, 19:00');
    expect(liveCardView(live(), undefined, 'UTC', t).meta).toBe('sex, 16 de out, 22:00 · 60 min');
  });

  it('"Exclusiva" comes only from the store: locked → the tag and ", exclusiva" in the name', () => {
    const view = liveCardView(live(), { locked: true }, TZ, t);
    expect(view.exclusive).toBe(true);
    expect(view.ariaLabel).toBe(
      'Tira-dúvidas de outubro, Agendada, sex, 16 de out, 19:00, exclusiva',
    );
    // The courses API says locked, the store read failed or the live is open: no tag.
    expect(liveCardView(live({ locked: true }), undefined, TZ, t).exclusive).toBe(false);
    expect(liveCardView(live(), { locked: false }, TZ, t).exclusive).toBe(false);
  });

  it('the href is /cursos/lives/{id}, keeping ?ver=aluno in a preview', () => {
    expect(liveCardView(live(), undefined, TZ, t).href).toBe(`/cursos/lives/${L}`);
    expect(liveCardView(live(), undefined, TZ, t, { preview: true }).href).toBe(
      `/cursos/lives/${L}?ver=aluno`,
    );
  });

  it('keys the live access list by live id; a null read stays null', () => {
    expect(liveAccessById(null)).toBeNull();
    const map = liveAccessById({
      items: [{ liveId: L, locked: true, gated: true, archivedTag: false }],
    });
    expect(map?.get(L)?.locked).toBe(true);
  });
});
