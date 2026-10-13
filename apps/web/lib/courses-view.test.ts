import { fileURLToPath } from 'node:url';
import type { CourseRow } from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  COURSE_FILTER_ORDER,
  courseFilterFromParam,
  courseFilterHref,
  courseRowView,
  formatBytes,
  formatCourseDuration,
  formatHours,
  formatLessonDuration,
  liveRowView,
  trackRowView,
} from './courses-view';

/**
 * 08.3-06 — the ONE courses formatter (UI-D-410, UI-D-392). Durations and sizes are built from the
 * asset's integers; the web never rounds a count and never sorts (P09, P29).
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as Parameters<typeof courseRowView>[1];

const C = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id: C,
    title: 'Harmonização facial do zero',
    status: 'draft',
    coverAssetId: null,
    categoryName: null,
    level: null,
    moduleCount: 2,
    lessonCount: 6,
    durationSeconds: 0,
    hasUnreadyVideo: false,
    createdAt: '2026-10-13T12:00:00.000Z',
    publishedAt: null,
    ...overrides,
  };
}

describe('formatCourseDuration (UI-D-410)', () => {
  it('omits zero, says minutes under an hour, hours and minutes above', () => {
    expect(formatCourseDuration(0)).toBe('');
    expect(formatCourseDuration(-5)).toBe('');
    expect(formatCourseDuration(2700)).toBe('45 min');
    expect(formatCourseDuration(8100)).toBe('2 h 15 min');
    expect(formatCourseDuration(3600)).toBe('1 h');
  });

  it('rounds to the nearest minute and never prints "0 min" for a positive length', () => {
    expect(formatCourseDuration(20)).toBe('1 min');
    expect(formatCourseDuration(89)).toBe('1 min');
    expect(formatCourseDuration(90)).toBe('2 min');
    expect(formatCourseDuration(3570)).toBe('1 h');
  });
});

describe('formatLessonDuration (UI-D-410, D-409)', () => {
  it('reads mm:ss under an hour and h:mm:ss above', () => {
    expect(formatLessonDuration(754)).toBe('12:34');
    expect(formatLessonDuration(65)).toBe('1:05');
    expect(formatLessonDuration(5)).toBe('0:05');
    expect(formatLessonDuration(3661)).toBe('1:01:01');
    expect(formatLessonDuration(3600)).toBe('1:00:00');
  });
});

describe('formatHours', () => {
  it('is the integer with the unit', () => {
    expect(formatHours(12)).toBe('12 h');
    expect(formatHours(0)).toBe('0 h');
  });
});

describe('formatBytes (P29, UI-D-410)', () => {
  it('binary units, one decimal, pt-BR comma, the formatMediaLimit labels', () => {
    expect(formatBytes(2_516_582)).toBe('2,4 MB');
    expect(formatBytes(184_320)).toBe('180 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });
});

describe('courseFilterFromParam / courseFilterHref (UI-D-391, E03 partial)', () => {
  it('maps the four pt-BR chip values; anything else reads as Todos', () => {
    expect(courseFilterFromParam(undefined)).toBe('all');
    expect(courseFilterFromParam('todos')).toBe('all');
    expect(courseFilterFromParam('rascunhos')).toBe('draft');
    expect(courseFilterFromParam('publicados')).toBe('published');
    expect(courseFilterFromParam('arquivados')).toBe('archived');
    expect(courseFilterFromParam('qualquer')).toBe('all');
    expect(courseFilterFromParam(['rascunhos', 'publicados'])).toBe('all');
    expect(courseFilterFromParam('constructor')).toBe('all');
  });

  it('builds the chip hrefs in the P57 order', () => {
    expect(COURSE_FILTER_ORDER).toEqual(['all', 'draft', 'published', 'archived']);
    expect(courseFilterHref('all')).toBe('/cursos');
    expect(courseFilterHref('draft')).toBe('/cursos?filtro=rascunhos');
    expect(courseFilterHref('published')).toBe('/cursos?filtro=publicados');
    expect(courseFilterHref('archived')).toBe('/cursos?filtro=arquivados');
  });
});

describe('courseRowView (UI-D-392)', () => {
  it('a draft with no ready video: counts only, the Rascunho pill, the "{title}, {status}" name', () => {
    const view = courseRowView(row(), t);
    expect(view).toEqual({
      id: C,
      href: `/cursos/${C}`,
      title: 'Harmonização facial do zero',
      meta: '2 módulos · 6 aulas',
      pills: [{ label: 'Rascunho', tone: 'neutral' }],
      ariaLabel: 'Harmonização facial do zero, Rascunho',
      coverAssetId: null,
      coverAlt: 'Capa do curso Harmonização facial do zero',
    });
  });

  it('a published course with ready videos: the duration joins the meta and the pill is success', () => {
    const view = courseRowView(
      row({
        status: 'published',
        moduleCount: 4,
        lessonCount: 18,
        durationSeconds: 8100,
        coverAssetId: A,
      }),
      t,
    );
    expect(view.meta).toBe('4 módulos · 18 aulas · 2 h 15 min');
    expect(view.pills).toEqual([{ label: 'Publicado', tone: 'success' }]);
    expect(view.ariaLabel).toBe('Harmonização facial do zero, Publicado');
    expect(view.coverAssetId).toBe(A);
  });

  it('a draft with an unready video: two pills, status first then Processando (warning)', () => {
    const view = courseRowView(row({ hasUnreadyVideo: true }), t);
    expect(view.pills).toEqual([
      { label: 'Rascunho', tone: 'neutral' },
      { label: 'Processando', tone: 'warning' },
    ]);
    // The accessible name carries the status alone; the second pill is read as a sibling.
    expect(view.ariaLabel).toBe('Harmonização facial do zero, Rascunho');
  });

  it('an archived course is neutral; singulars pluralise 1 módulo · 1 aula', () => {
    const view = courseRowView(row({ status: 'archived', moduleCount: 1, lessonCount: 1 }), t);
    expect(view.pills).toEqual([{ label: 'Arquivado', tone: 'neutral' }]);
    expect(view.meta).toBe('1 módulo · 1 aula');
  });
});

describe('trackRowView and liveRowView scaffolds (UI-D-392, plans 10 and 11)', () => {
  it('a track: "{N} cursos" with the =0 form, Arquivada only when archived', () => {
    const active = trackRowView(
      {
        id: C,
        title: 'Do zero ao atendimento',
        status: 'active',
        coverAssetId: null,
        courseCount: 3,
      },
      t,
    );
    expect(active.href).toBe(`/cursos/trilhas/${C}`);
    expect(active.meta).toBe('3 cursos');
    expect(active.pills).toEqual([]);
    const none = trackRowView(
      { id: C, title: 'T', status: 'archived', coverAssetId: null, courseCount: 0 },
      t,
    );
    expect(none.meta).toBe('Nenhum curso');
    expect(none.pills).toEqual([{ label: 'Arquivada', tone: 'neutral' }]);
    expect(none.ariaLabel).toBe('T, Arquivada');
  });

  it('a live: the tenant-zone date line and the derived pill; Ao vivo is the only success', () => {
    const live = {
      id: C,
      title: 'Tira-dúvidas de outubro',
      coverAssetId: null,
      // 22:00 UTC on the 16th is 19:00 in São Paulo (UTC-3) the same day.
      startsAt: '2026-10-16T22:00:00.000Z',
      durationMin: 60,
    };
    const scheduled = liveRowView(
      { ...live, status: 'scheduled' },
      { timezone: 'America/Sao_Paulo' },
      t,
    );
    expect(scheduled.href).toBe(`/cursos/lives/${C}`);
    expect(scheduled.meta).toBe('sex, 16 de out, 19:00 · 60 min');
    expect(scheduled.pills).toEqual([{ label: 'Agendada', tone: 'neutral' }]);
    const onAir = liveRowView({ ...live, status: 'live' }, { timezone: 'Europe/Lisbon' }, t);
    expect(onAir.meta).toBe('sex, 16 de out, 23:00 · 60 min');
    expect(onAir.pills).toEqual([{ label: 'Ao vivo', tone: 'success' }]);
    expect(liveRowView({ ...live, status: 'cancelled' }, { timezone: 'UTC' }, t).pills).toEqual([
      { label: 'Cancelada', tone: 'neutral' },
    ]);
  });
});
