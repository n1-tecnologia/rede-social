import { fileURLToPath } from 'node:url';
import type {
  LearnCategoryTile,
  LearnCourse,
  LearnCourseCard,
  LearnLesson,
  LearnLive,
  LearnLiveCard,
  LearnMyProgress,
  LearnNewLesson,
  LearnOutlineLesson,
  LearnOutlineModule,
  LearnOverviewHero,
  LearnOverviewLive,
  LearnOverviewTrack,
  LearnShelfItem,
  LearnTrack,
  LearnTrackCourse,
} from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  catalogueCategoryHref,
  categoryFromParam,
  categoryTileView,
  courseAccessById,
  courseActionView,
  courseCardTags,
  courseCardView,
  courseHeroView,
  coursePercent,
  courseSeconds,
  curriculumOpenModules,
  curriculumView,
  formatWatched,
  homeHeroView,
  homeLiveView,
  homeTrackView,
  isPreview,
  lessonLockView,
  lessonNavView,
  lessonPageView,
  liveAccessById,
  liveCardView,
  livePageView,
  MEMBER_CATALOGUE_HREF,
  MEMBER_LIVES_HREF,
  memberAreaRedirectHref,
  memberLessonRowView,
  memberTracksHref,
  newLessonView,
  otherTrackView,
  progressTabView,
  relativeDayLabel,
  selectedTrackId,
  shelfRowView,
  streakBadgeView,
  trackStepView,
  trackTabView,
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

  it('08.6 (UI-D-446): "Todas" is /area-membros?aba=cursos, a category adds &categoria=, a preview keeps ver=aluno', () => {
    expect(catalogueCategoryHref(null)).toBe('/area-membros?aba=cursos');
    expect(catalogueCategoryHref(null)).toBe(MEMBER_CATALOGUE_HREF);
    expect(catalogueCategoryHref(K)).toBe(`/area-membros?aba=cursos&categoria=${K}`);
    expect(catalogueCategoryHref(null, true)).toBe('/area-membros?aba=cursos&ver=aluno');
    expect(catalogueCategoryHref(K, true)).toBe(
      `/area-membros?aba=cursos&categoria=${K}&ver=aluno`,
    );
    // The bare area means Início: no catalogue link may lead there.
    for (const href of [catalogueCategoryHref(null), catalogueCategoryHref(K, true)]) {
      expect(href).not.toBe('/area-membros');
      expect(href).toContain('aba=cursos');
    }
  });
});

describe('memberAreaRedirectHref (quick 261019-k7x, T-k7x-02)', () => {
  it('no query is the bare area, a preview keeps ver=aluno', () => {
    expect(memberAreaRedirectHref({})).toBe('/area-membros');
    expect(memberAreaRedirectHref({}, true)).toBe('/area-membros?ver=aluno');
  });

  it('keeps aba, categoria and trilha, encoded exactly as memberHref encodes them', () => {
    expect(memberAreaRedirectHref({ aba: 'lives' })).toBe('/area-membros?aba=lives');
    expect(memberAreaRedirectHref({ aba: 'trilhas', trilha: 'T1' })).toBe(
      '/area-membros?aba=trilhas&trilha=T1',
    );
    expect(memberAreaRedirectHref({ aba: 'cursos', categoria: 'a b&c' })).toBe(
      '/area-membros?aba=cursos&categoria=a+b%26c',
    );
  });

  it('drops a repeated or empty value and never copies another key', () => {
    expect(memberAreaRedirectHref({ aba: ['lives', 'cursos'], categoria: ['a', 'b'] })).toBe(
      '/area-membros',
    );
    expect(memberAreaRedirectHref({ aba: '', categoria: '', trilha: '' })).toBe('/area-membros');
    expect(
      memberAreaRedirectHref({ aba: 'lives', filtro: 'x', ver: 'admin' } as Record<string, string>),
    ).toBe('/area-membros?aba=lives');
  });

  it('appends ver=aluno last in a preview', () => {
    expect(memberAreaRedirectHref({ aba: 'lives' }, true)).toBe(
      '/area-membros?aba=lives&ver=aluno',
    );
  });

  it('keeps a URL-shaped or protocol-relative value an encoded query value (no open redirect)', () => {
    for (const value of ['https://evil.example/x', '//evil.example', '/\\evil.example']) {
      const href = memberAreaRedirectHref({ aba: value });
      expect(href.startsWith('/area-membros?aba=')).toBe(true);
      expect(href.split('?')[0]).toBe('/area-membros');
      expect(href.slice('/area-membros?aba='.length)).toBe(encodeURIComponent(value));
    }
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

/* ── 08.5-07: the course page (UI-D-427..UI-D-430, EP-11, EP-12, EP-13, E07) ─────────────────── */

const COURSE = '44444444-4444-4444-8444-444444444444';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function lesson(n: number, overrides: Partial<LearnOutlineLesson> = {}): LearnOutlineLesson {
  return {
    id: uuid(n),
    title: `Aula ${n}`,
    position: n,
    number: n,
    durationSeconds: 754,
    hasVideo: true,
    isFree: false,
    requiresPrevious: false,
    lockReason: null,
    completedAt: null,
    lastPositionSeconds: 0,
    ...overrides,
  };
}

function mod(
  n: number,
  lessons: LearnOutlineLesson[],
  overrides: Partial<LearnOutlineModule> = {},
): LearnOutlineModule {
  return {
    id: uuid(100 + n),
    title: `Módulo ${n}`,
    position: n,
    number: n,
    requiresPrevious: false,
    lockReason: null,
    lessons,
    ...overrides,
  };
}

function course(overrides: Partial<LearnCourse> = {}): LearnCourse {
  return {
    id: COURSE,
    title: 'Harmonização facial do zero',
    tagline: 'Do primeiro ponto ao resultado natural.',
    description: '',
    coverAssetId: null,
    category: { id: K, name: 'Lábios' },
    level: 'iniciante',
    instructorName: 'Dra. Ana',
    instructorPhotoAssetId: null,
    outcomes: [],
    certificateHours: 12,
    locked: false,
    modules: [],
    progress: {
      done: 0,
      total: 0,
      percent: 0,
      nextLessonId: null,
      firstLessonId: null,
      firstFreeLessonId: null,
    },
    ...overrides,
  };
}

const DONE = '2026-10-15T10:00:00.000Z';

describe('isPreview (UI-D-437, planning decision 5, T-08.5-27)', () => {
  it('only an admin_tenant with ?ver=aluno previews', () => {
    expect(isPreview({ membership: { role: 'admin_tenant' } }, 'aluno')).toBe(true);
    expect(isPreview({ membership: { role: 'admin_tenant' } }, undefined)).toBe(false);
    expect(isPreview({ membership: { role: 'admin_tenant' } }, ['aluno', 'aluno'])).toBe(false);
    expect(isPreview({ membership: { role: 'support_tenant' } }, 'aluno')).toBe(false);
    expect(isPreview({ membership: { role: 'member' } }, 'aluno')).toBe(false);
  });
});

describe('courseActionView (UI-D-427, D-430, EP-11)', () => {
  const base = {
    done: 0,
    total: 3,
    nextLessonId: uuid(1),
    firstLessonId: uuid(1),
    firstFreeLessonId: null,
  };
  const opts = { courseId: COURSE, durationSeconds: 42 * 60 };

  it('EP-11: percent 0 → start, with "{N} aulas · {duration}" and "Começar o curso"', () => {
    const view = courseActionView({ ...base, percent: 0 }, t, opts);
    expect(view).toEqual({
      variant: 'start',
      line: '3 aulas · 42 min',
      label: 'Começar o curso',
      href: `/cursos/${COURSE}/aulas/${uuid(1)}`,
    });
  });

  it('EP-11: percent 1 and 99 → continue with the bar, the line and "Continuar o curso"', () => {
    for (const percent of [1, 99]) {
      const view = courseActionView({ ...base, done: 1, percent, nextLessonId: uuid(2) }, t, opts);
      expect(view?.variant).toBe('continue');
      if (view?.variant !== 'continue') throw new Error('variant');
      expect(view.percent).toBe(percent);
      expect(view.progressLabel).toBe(`${percent}% concluído`);
      expect(view.line).toBe(`${percent}% concluído · 1 de 3 aulas concluídas`);
      expect(view.label).toBe('Continuar o curso');
      expect(view.href).toBe(`/cursos/${COURSE}/aulas/${uuid(2)}`);
    }
  });

  it('continue with no open lesson next → no href, the line stays', () => {
    const view = courseActionView({ ...base, done: 1, percent: 33, nextLessonId: null }, t, opts);
    expect(view?.variant).toBe('continue');
    expect(view?.href).toBeNull();
    expect(view?.line).toBe('33% concluído · 1 de 3 aulas concluídas');
  });

  it('EP-11: percent 100 → done, "Curso concluído · 3 de 3 aulas" and "Rever o curso" to the first lesson', () => {
    const view = courseActionView({ ...base, done: 3, percent: 100, nextLessonId: null }, t, opts);
    expect(view).toEqual({
      variant: 'done',
      line: 'Curso concluído · 3 de 3 aulas',
      label: 'Rever o curso',
      href: `/cursos/${COURSE}/aulas/${uuid(1)}`,
    });
  });

  it('EP-13: a course with no live lesson has no action at all', () => {
    expect(
      courseActionView({ ...base, total: 0, percent: 0, nextLessonId: null }, t, opts),
    ).toBeNull();
  });

  it('0% with no ready video → the plain "{N} aulas"; preview keeps ?ver=aluno', () => {
    const view = courseActionView({ ...base, percent: 0 }, t, {
      courseId: COURSE,
      durationSeconds: 0,
      preview: true,
    });
    expect(view?.line).toBe('3 aulas');
    expect(view?.href).toBe(`/cursos/${COURSE}/aulas/${uuid(1)}?ver=aluno`);
  });
});

describe('memberLessonRowView (UI-D-430, E07 partial)', () => {
  const ctx = { courseId: COURSE, moduleNumber: 2 };

  it('open video lesson → "mm:ss", chevron, open thumb, the title alone as its name', () => {
    const view = memberLessonRowView(lesson(1), t, ctx);
    expect(view).toMatchObject({
      meta: '12:34',
      metaLocked: false,
      trailing: 'chevron',
      thumbState: 'open',
      ariaLabel: 'Aula 1',
      href: `/cursos/${COURSE}/aulas/${uuid(1)}`,
    });
  });

  it('a free lesson reads "{mm:ss} · Aula aberta"; a lesson without video reads "Prática"', () => {
    expect(memberLessonRowView(lesson(1, { isFree: true }), t, ctx).meta).toBe(
      '12:34 · Aula aberta',
    );
    expect(
      memberLessonRowView(lesson(1, { hasVideo: false, durationSeconds: null }), t, ctx).meta,
    ).toBe('Prática');
    expect(
      memberLessonRowView(
        lesson(1, { hasVideo: false, durationSeconds: null, isFree: true }),
        t,
        ctx,
      ).meta,
    ).toBe('Prática · Aula aberta');
    expect(
      memberLessonRowView(lesson(1, { isFree: true, durationSeconds: null }), t, ctx).meta,
    ).toBe('Aula aberta');
  });

  it('purchase lock → "{mm:ss} · Aula exclusiva", lock trailing, ", exclusiva" in the name', () => {
    const view = memberLessonRowView(lesson(3, { lockReason: 'purchase' }), t, ctx);
    expect(view).toMatchObject({
      meta: '12:34 · Aula exclusiva',
      metaLocked: true,
      trailing: 'locked',
      thumbState: 'locked',
      ariaLabel: 'Aula 3, exclusiva',
    });
    expect(
      memberLessonRowView(
        lesson(3, { lockReason: 'purchase', hasVideo: false, durationSeconds: null }),
        t,
        ctx,
      ).meta,
    ).toBe('Prática · Aula exclusiva');
  });

  it('sequence locks name the reason; the module rule names the PREVIOUS module, two digits', () => {
    expect(memberLessonRowView(lesson(4, { lockReason: 'lesson' }), t, ctx)).toMatchObject({
      meta: 'Libera ao concluir a aula anterior',
      ariaLabel: 'Aula 4, bloqueada',
    });
    expect(memberLessonRowView(lesson(4, { lockReason: 'module' }), t, ctx).meta).toBe(
      'Libera ao concluir o Módulo 01',
    );
  });

  it('done → check and dimmed thumb; in progress → resume ratio and "em andamento"', () => {
    expect(memberLessonRowView(lesson(1, { completedAt: DONE }), t, ctx)).toMatchObject({
      trailing: 'done',
      thumbState: 'done',
      ariaLabel: 'Aula 1, concluída',
    });
    const progress = memberLessonRowView(lesson(1, { lastPositionSeconds: 377 }), t, ctx);
    expect(progress).toMatchObject({
      thumbState: 'progress',
      resumePercent: 50,
      ariaLabel: 'Aula 1, em andamento',
    });
  });

  it('preview keeps ?ver=aluno on the row; the current row reads "Assistindo agora"', () => {
    const view = memberLessonRowView(lesson(1), t, {
      ...ctx,
      preview: true,
      currentLessonId: uuid(1),
    });
    expect(view.href).toBe(`/cursos/${COURSE}/aulas/${uuid(1)}?ver=aluno`);
    expect(view.current).toBe(true);
    expect(view.meta).toBe('Assistindo agora');
  });
});

describe('curriculumView (UI-D-429)', () => {
  it('bands: numeral, pill, meta, state and name; empty modules are not listed', () => {
    const view = curriculumView(
      course({
        modules: [
          mod(1, [lesson(1, { completedAt: DONE }), lesson(2, { completedAt: DONE })]),
          mod(2, [lesson(3, { lockReason: 'module' })], {
            lockReason: 'module',
            requiresPrevious: true,
          }),
          mod(3, [lesson(4, { completedAt: DONE }), lesson(5), lesson(6)]),
          mod(4, []),
        ],
      }),
      false,
      t,
    );
    expect(view.moduleCount).toBe(3);
    expect(view.lessonCount).toBe(6);
    expect(view.countLabel).toBe('3 módulos · 6 aulas');
    const [one, two, three] = view.modules;
    expect(one).toMatchObject({
      numeral: '01',
      pill: 'Concluído',
      meta: '2 aulas · 25 min',
      state: { kind: 'done' },
      ariaLabel: 'Módulo 01: Módulo 1, concluído',
    });
    expect(two).toMatchObject({
      pill: 'Módulo 02',
      meta: 'Libera ao concluir o Módulo 01',
      metaLocked: true,
      state: { kind: 'locked' },
      ariaLabel: 'Módulo 02: Módulo 2, bloqueado',
    });
    expect(three).toMatchObject({
      state: { kind: 'ring', percent: 33 },
      ariaLabel: 'Módulo 03: Módulo 3, 33% concluído',
    });
  });

  it('a purchase-locked band keeps its meta and shows the lock disc', () => {
    const view = curriculumView(
      course({
        locked: true,
        modules: [mod(1, [lesson(1, { lockReason: 'purchase' })], { lockReason: 'purchase' })],
      }),
      false,
      t,
    );
    expect(view.modules[0]).toMatchObject({
      meta: '1 aula · 13 min',
      metaLocked: false,
      state: { kind: 'locked' },
    });
  });

  it('one module, one lesson: the singular counts', () => {
    expect(curriculumView(course({ modules: [mod(1, [lesson(1)])] }), false, t).countLabel).toBe(
      '1 módulo · 1 aula',
    );
  });
});

describe('curriculumOpenModules (UI-D-429, EP-12)', () => {
  const m1 = (done: boolean) =>
    mod(1, [
      lesson(1, { completedAt: done ? DONE : null }),
      lesson(2, { completedAt: done ? DONE : null }),
    ]);
  const m2 = (doneFirst = false) =>
    mod(2, [lesson(3, { completedAt: doneFirst ? DONE : null }), lesson(4)]);

  it('0% → module 1 only', () => {
    const c = course({
      modules: [m1(false), m2()],
      progress: {
        done: 0,
        total: 4,
        percent: 0,
        nextLessonId: uuid(1),
        firstLessonId: uuid(1),
        firstFreeLessonId: null,
      },
    });
    expect(curriculumOpenModules(c)).toEqual([uuid(101)]);
  });

  it('EP-12: module 1 complete, none of module 2 → module 2 (the module of nextLessonId) and only it', () => {
    const c = course({
      modules: [m1(true), m2()],
      progress: {
        done: 2,
        total: 4,
        percent: 50,
        nextLessonId: uuid(3),
        firstLessonId: uuid(1),
        firstFreeLessonId: null,
      },
    });
    expect(curriculumOpenModules(c)).toEqual([uuid(102)]);
  });

  it('modules part-way → those modules', () => {
    const c = course({
      modules: [m1(true), m2(true)],
      progress: {
        done: 3,
        total: 4,
        percent: 75,
        nextLessonId: uuid(4),
        firstLessonId: uuid(1),
        firstFreeLessonId: null,
      },
    });
    expect(curriculumOpenModules(c)).toEqual([uuid(102)]);
  });

  it('100% → all closed', () => {
    const c = course({
      modules: [m1(true)],
      progress: {
        done: 2,
        total: 2,
        percent: 100,
        nextLessonId: null,
        firstLessonId: uuid(1),
        firstFreeLessonId: null,
      },
    });
    expect(curriculumOpenModules(c)).toEqual([]);
  });

  it('a locked course → module 1 plus the module of the first free lesson', () => {
    const c = course({
      locked: true,
      modules: [m1(false), mod(2, [lesson(3, { isFree: true }), lesson(4)])],
      progress: {
        done: 0,
        total: 4,
        percent: 0,
        nextLessonId: uuid(3),
        firstLessonId: uuid(1),
        firstFreeLessonId: uuid(3),
      },
    });
    expect(curriculumOpenModules(c)).toEqual([uuid(101), uuid(102)]);
  });

  it('no module → nothing to open', () => {
    expect(curriculumOpenModules(course())).toEqual([]);
  });
});

describe('courseHeroView / courseSeconds (UI-D-427, E05 populated)', () => {
  it('empty description and outcomes are null / empty (the sections are absent)', () => {
    const view = courseHeroView(course({ outcomes: ['', '  '] }), t);
    expect(view.description).toBeNull();
    expect(view.outcomes).toEqual([]);
    expect(view.categoryPill).toBe('Lábios');
    expect(view.pills).toEqual(['Iniciante', '12 h']);
    expect(view.instructorLine).toBe('Com Dra. Ana');
  });

  it("sums every live lesson's ready seconds", () => {
    expect(
      courseSeconds(
        course({ modules: [mod(1, [lesson(1), lesson(2, { durationSeconds: null })])] }),
      ),
    ).toBe(754);
  });
});

/* ── 08.5-08: the lesson player's views (UI-D-432, D-427, D-430, E09) ─────────────────────────── */

function learnLesson(overrides: Partial<LearnLesson> = {}): LearnLesson {
  return {
    id: uuid(3),
    courseId: COURSE,
    courseTitle: 'Harmonização facial do zero',
    coverAssetId: null,
    instructorName: 'Dra. Ana',
    instructorPhotoAssetId: null,
    moduleId: uuid(102),
    moduleTitle: 'Técnica',
    moduleNumber: 2,
    lessonNumber: 3,
    title: 'Pontos de aplicação',
    description: 'Como marcar os pontos.',
    isFree: false,
    videoAssetId: uuid(900),
    videoStatus: 'ready',
    durationSeconds: 754,
    materials: [
      {
        id: uuid(800),
        filename: 'Protocolo.pdf',
        kind: 'pdf',
        mime: 'application/pdf',
        bytes: 2516582,
      },
    ],
    progress: { completedAt: null, lastPositionSeconds: 42 },
    moduleLessons: [
      lesson(2, { completedAt: DONE }),
      lesson(3),
      lesson(4, { lockReason: 'lesson' }),
    ],
    moduleProgress: { done: 2, total: 5 },
    previous: { id: uuid(2), lockReason: null },
    next: { id: uuid(4), lockReason: null },
    ...overrides,
  };
}

describe('lessonPageView (UI-D-432, D-430, E09)', () => {
  it('E09 populated: pills, duration, resume, module bar, materials and the current row', () => {
    const view = lessonPageView(learnLesson(), t);
    expect(view.courseTitle).toBe('Harmonização facial do zero');
    expect(view.courseHref).toBe(`/cursos/${COURSE}`);
    expect(view.pills).toEqual(['Módulo 02', 'Aula 03']);
    expect(view.duration).toBe('12:34');
    expect(view.instructorLine).toBe('Com Dra. Ana');
    expect(view.video).toEqual({ assetId: uuid(900), status: 'ready', startTime: 42 });
    expect(view.completed).toBe(false);
    expect(view.moduleBar).toEqual({
      percent: 40,
      progressLabel: '40% concluído',
      line: 'Módulo 02 · 2 de 5 aulas concluídas',
    });
    expect(view.materials).toEqual([
      {
        id: uuid(800),
        name: 'Protocolo.pdf',
        meta: 'PDF · 2,4 MB',
        kind: 'pdf',
        downloadLabel: 'Baixar Protocolo.pdf',
      },
    ]);
    expect(view.materialsCount).toBe('1 arquivo');
    expect(view.moduleTitle).toBe('Técnica');
    const current = view.moduleRows.find((row) => row.current);
    expect(current?.id).toBe(uuid(3));
    expect(current?.meta).toBe('Assistindo agora');
    expect(view.moduleRows.map((row) => row.trailing)).toEqual(['done', 'chevron', 'locked']);
  });

  it('E09 partial: a free lesson reads "Aula aberta"; no video → "Prática" and no media block', () => {
    expect(lessonPageView(learnLesson({ isFree: true }), t).pills).toEqual([
      'Módulo 02',
      'Aula 03',
      'Aula aberta',
    ]);
    const practice = lessonPageView(
      learnLesson({ videoAssetId: null, videoStatus: 'none', durationSeconds: null }),
      t,
    );
    expect(practice.pills).toEqual(['Módulo 02', 'Aula 03', 'Prática']);
    expect(practice.video).toBeNull();
    expect(practice.duration).toBeNull();
  });

  it('E09 empty: no description and no material; the materials count pluralises', () => {
    const view = lessonPageView(learnLesson({ description: '  ', materials: [] }), t);
    expect(view.description).toBeNull();
    expect(view.materials).toEqual([]);
    const two = lessonPageView(
      learnLesson({
        materials: [
          { id: uuid(801), filename: 'a.pdf', kind: 'pdf', mime: 'application/pdf', bytes: 10 },
          { id: uuid(802), filename: 'b.png', kind: 'image', mime: 'image/png', bytes: 2048 },
        ],
      }),
      t,
    );
    expect(two.materialsCount).toBe('2 arquivos');
    expect(two.materials[1]?.meta).toBe('Imagem · 2 KB');
  });

  it('a processing video keeps its status; a completed lesson is completed; preview keeps ?ver=aluno', () => {
    const view = lessonPageView(
      learnLesson({
        videoStatus: 'processing',
        progress: { completedAt: DONE, lastPositionSeconds: 0 },
      }),
      t,
      { preview: true },
    );
    expect(view.video?.status).toBe('processing');
    expect(view.completed).toBe(true);
    expect(view.courseHref).toBe(`/cursos/${COURSE}?ver=aluno`);
    expect(view.moduleRows[0]?.href).toBe(`/cursos/${COURSE}/aulas/${uuid(2)}?ver=aluno`);
  });

  it('a one-lesson module lists only the current row (E09 zero-one-many)', () => {
    const view = lessonPageView(
      learnLesson({ moduleLessons: [lesson(3)], moduleProgress: { done: 0, total: 1 } }),
      t,
    );
    expect(view.moduleRows).toHaveLength(1);
    expect(view.moduleRows[0]?.current).toBe(true);
  });
});

describe('lessonNavView (UI-D-432, E07/E09: labels only, never a decision)', () => {
  it('open neighbours → both links, "Próxima aula"', () => {
    const nav = lessonNavView(learnLesson(), t);
    expect(nav.previousHref).toBe(`/cursos/${COURSE}/aulas/${uuid(2)}`);
    expect(nav.previousLabel).toBe('Aula anterior');
    expect(nav.next).toEqual({
      kind: 'open',
      href: `/cursos/${COURSE}/aulas/${uuid(4)}`,
      label: 'Próxima aula',
    });
  });

  it("the next lesson's lock reason names the button: lesson, module, purchase", () => {
    const label = (lockReason: 'lesson' | 'module' | 'purchase') =>
      lessonNavView(learnLesson({ next: { id: uuid(4), lockReason } }), t).next;
    expect(label('lesson')).toEqual({ kind: 'locked', label: 'Conclua esta aula' });
    expect(label('module')).toEqual({ kind: 'locked', label: 'Conclua o módulo' });
    expect(label('purchase')).toEqual({ kind: 'locked', label: 'Aula exclusiva' });
  });

  it('no previous, or a locked previous → the disabled span; no next → "Voltar para o curso"', () => {
    expect(lessonNavView(learnLesson({ previous: null }), t).previousHref).toBeNull();
    expect(
      lessonNavView(learnLesson({ previous: { id: uuid(2), lockReason: 'purchase' } }), t)
        .previousHref,
    ).toBeNull();
    expect(lessonNavView(learnLesson({ next: null }), t, { preview: true }).next).toEqual({
      kind: 'end',
      href: `/cursos/${COURSE}?ver=aluno`,
      label: 'Voltar para o curso',
    });
  });
});

describe('lessonLockView (UI-D-431, D-424, D-428, T-08.5-13)', () => {
  const outline = course({
    modules: [
      mod(1, [
        lesson(1, { isFree: true }),
        lesson(2, { lockReason: 'lesson', durationSeconds: 510 }),
      ]),
      mod(2, [lesson(3, { lockReason: 'module', hasVideo: false, durationSeconds: null })]),
    ],
    progress: {
      done: 0,
      total: 3,
      percent: 0,
      nextLessonId: uuid(1),
      firstLessonId: uuid(1),
      firstFreeLessonId: uuid(1),
    },
  });

  it('sequence, lesson rule: "Bloqueada", the sentence, brand "Continuar o curso" to nextLessonId', () => {
    const view = lessonLockView(outline, uuid(2), 'sequence', t);
    expect(view).toMatchObject({
      courseTitle: 'Harmonização facial do zero',
      courseHref: `/cursos/${COURSE}`,
      mediaPill: 'Bloqueada',
      pills: ['Módulo 01', 'Aula 02'],
      duration: '8:30',
      title: 'Aula 2',
      instructorLine: 'Com Dra. Ana',
      freeLessonHref: null,
      sequence: {
        title: 'Aula ainda bloqueada',
        body: 'Libera ao concluir a aula anterior.',
        action: {
          href: `/cursos/${COURSE}/aulas/${uuid(1)}`,
          label: 'Continuar o curso',
          brand: true,
        },
      },
    });
  });

  it('sequence, module rule: the previous module named; no nextLessonId → outline "Voltar para o curso"', () => {
    const view = lessonLockView(
      { ...outline, progress: { ...outline.progress, nextLessonId: null } },
      uuid(3),
      'sequence',
      t,
      { preview: true },
    );
    expect(view?.pills).toEqual(['Módulo 02', 'Aula 03', 'Prática']);
    expect(view?.duration).toBeNull();
    expect(view?.sequence?.body).toBe('Libera ao concluir o Módulo 01.');
    expect(view?.sequence?.action).toEqual({
      href: `/cursos/${COURSE}?ver=aluno`,
      label: 'Voltar para o curso',
      brand: false,
    });
  });

  it('purchase: "Exclusiva", no sequence notice, the free-lesson door', () => {
    const view = lessonLockView(outline, uuid(2), 'purchase', t);
    expect(view?.mediaPill).toBe('Exclusiva');
    expect(view?.sequence).toBeNull();
    expect(view?.freeLessonHref).toBe(`/cursos/${COURSE}/aulas/${uuid(1)}`);
    const noFree = lessonLockView(
      { ...outline, progress: { ...outline.progress, firstFreeLessonId: null } },
      uuid(2),
      'purchase',
      t,
    );
    expect(noFree?.freeLessonHref).toBeNull();
  });

  it('a lesson the outline does not list → null (the page not-found)', () => {
    expect(lessonLockView(outline, uuid(99), 'purchase', t)).toBeNull();
  });

  it('the view carries titles only: no description, video or material key (PR-1)', () => {
    const view = lessonLockView(outline, uuid(2), 'purchase', t);
    expect(Object.keys(view ?? {})).not.toEqual(
      expect.arrayContaining(['description', 'video', 'materials']),
    );
  });
});

describe('livePageView (08.5-09, UI-D-435, UI-D-436, D-431..D-434, E10)', () => {
  const LIVE = '66666666-6666-4666-8666-666666666666';
  const REPLAY = '77777777-7777-4777-8777-777777777777';
  const ASSET = '88888888-8888-4888-8888-888888888888';
  const TZ = 'America/Sao_Paulo';
  // Thursday 2026-10-22, 19:00 in São Paulo.
  const START = '2026-10-22T22:00:00.000Z';

  function live(overrides: Partial<LearnLive> = {}): LearnLive {
    return {
      id: LIVE,
      title: 'Tira-dúvidas de outubro',
      coverAssetId: null,
      startsAt: START,
      durationMin: 60,
      endsAt: '2026-10-22T23:00:00.000Z',
      status: 'scheduled',
      locked: false,
      hasReplay: false,
      description: 'Traga as dúvidas do mês.',
      state: 'before',
      joinUrl: null,
      joinOpensAt: '2026-10-22T21:45:00.000Z',
      serverNow: '2026-10-20T12:00:00.000Z',
      startsToday: false,
      replay: null,
      ...overrides,
    };
  }

  const material = (n: number) => ({
    id: uuid(50 + n),
    filename: `Slides ${n}.pdf`,
    kind: 'pdf' as const,
    mime: 'application/pdf',
    bytes: 820 * 1024,
  });

  it('the header, the long-form date line in the tenant timezone, the back to the Lives tab', () => {
    const view = livePageView(live(), TZ, t);
    expect(view.title).toBe('Tira-dúvidas de outubro');
    expect(view.backHref).toBe(MEMBER_LIVES_HREF);
    expect(MEMBER_LIVES_HREF).toBe('/area-membros?aba=lives');
    expect(view.meta).toBe('quinta, 22 de outubro, 19:00 · 60 min');
    expect(view.coverAlt).toBe('Capa da live Tira-dúvidas de outubro');
    expect(view.description).toBe('Traga as dúvidas do mês.');
    expect(livePageView(live({ description: '  ' }), TZ, t).description).toBeNull();
  });

  it('weekdays without "-feira" stay whole (sábado, domingo)', () => {
    const saturday = livePageView(live({ startsAt: '2026-10-24T22:00:00.000Z' }), TZ, t);
    expect(saturday.meta).toBe('sábado, 24 de outubro, 19:00 · 60 min');
  });

  it('before: "Começa em {date}, às {time}." and the 15-minute hint; the timer edges', () => {
    const view = livePageView(live(), TZ, t);
    expect(view.zone).toEqual({
      state: 'before',
      line: 'Começa em 22 de outubro, às 19:00.',
      hint: 'O link para entrar aparece 15 minutos antes do início.',
    });
    expect(view.statusPill).toEqual({ label: 'Agendada', icon: null });
    expect(view.refresh).toEqual({
      joinOpensAt: '2026-10-22T21:45:00.000Z',
      startsAt: START,
      endsAt: '2026-10-22T23:00:00.000Z',
      serverNow: '2026-10-20T12:00:00.000Z',
    });
  });

  it('"Começa hoje" vs "Começa em" is the SERVER\'s startsToday, never the clock', () => {
    const view = livePageView(live({ startsToday: true }), TZ, t);
    expect(view.zone).toMatchObject({ state: 'before', line: 'Começa hoje, às 19:00.' });
  });

  it('open before the start: the API link, "A live começa às {time}. Você já pode entrar."', () => {
    const view = livePageView(
      live({ state: 'open', joinUrl: 'https://example.test/room', status: 'scheduled' }),
      TZ,
      t,
    );
    expect(view.zone).toEqual({
      state: 'open',
      href: 'https://example.test/room',
      label: 'Entrar na live',
      helper: 'A live começa às 19:00. Você já pode entrar.',
    });
    expect(view.refresh).not.toBeNull();
  });

  it('open on air: "Ao vivo agora" with the radio glyph, "A live acontece fora do app…"', () => {
    const view = livePageView(
      live({ state: 'open', joinUrl: 'https://example.test/room', status: 'live' }),
      TZ,
      t,
    );
    expect(view.statusPill).toEqual({ label: 'Ao vivo agora', icon: 'radio' });
    expect(view.zone).toMatchObject({
      state: 'open',
      helper: 'A live acontece fora do app, no link da transmissão.',
    });
  });

  it('open without a usable https link never invents one: the before words, no href', () => {
    for (const joinUrl of [null, 'javascript:alert(1)', 'http://example.test/room', 'nope']) {
      const view = livePageView(live({ state: 'open', joinUrl, status: 'live' }), TZ, t);
      expect(view.zone.state, String(joinUrl)).toBe('before');
      expect(JSON.stringify(view)).not.toContain('example.test');
    }
  });

  it('cancelled: "Esta live foi cancelada.", the "Cancelada" pill, no timer — even when locked', () => {
    const view = livePageView(
      live({ state: 'cancelled', status: 'cancelled', locked: true }),
      TZ,
      t,
    );
    expect(view.zone).toEqual({ state: 'cancelled', text: 'Esta live foi cancelada.' });
    expect(view.statusPill).toEqual({ label: 'Cancelada', icon: null });
    expect(view.exclusive).toBe(true);
    expect(view.refresh).toBeNull();
  });

  it('locked: the zone carries no words and no link; "Exclusiva" follows the pill', () => {
    const view = livePageView(live({ state: 'locked', locked: true }), TZ, t);
    expect(view.zone).toEqual({ state: 'locked' });
    expect(view.exclusive).toBe(true);
    expect(view.refresh).toBeNull();
  });

  it('replay: the button words, the player at the stored place, the materials (1 → "1 arquivo")', () => {
    const view = livePageView(
      live({
        state: 'replay',
        status: 'recorded',
        hasReplay: true,
        replay: {
          lessonId: REPLAY,
          videoAssetId: ASSET,
          videoStatus: 'ready',
          durationSeconds: 3600,
          materials: [material(1)],
          progress: { completedAt: null, lastPositionSeconds: 312 },
        },
      }),
      TZ,
      t,
    );
    expect(view.statusPill).toEqual({ label: 'Gravada', icon: null });
    expect(view.refresh).toBeNull();
    expect(view.zone).toMatchObject({
      state: 'replay',
      lessonId: REPLAY,
      label: 'Assistir ao replay',
      video: { assetId: ASSET, status: 'ready', startTime: 312 },
      completed: false,
      materialsTitle: 'Materiais da gravação',
      materialsCount: '1 arquivo',
    });
    if (view.zone.state !== 'replay') throw new Error('replay');
    expect(view.zone.materials).toEqual([
      {
        id: uuid(51),
        name: 'Slides 1.pdf',
        meta: 'PDF · 820 KB',
        kind: 'pdf',
        downloadLabel: 'Baixar Slides 1.pdf',
      },
    ]);
  });

  it('replay materials: 0 → none, many → every row and "{n} arquivos"', () => {
    const base = {
      lessonId: REPLAY,
      videoAssetId: ASSET,
      videoStatus: 'ready' as const,
      durationSeconds: 3600,
      progress: { completedAt: '2026-10-23T00:00:00.000Z', lastPositionSeconds: 0 },
    };
    const none = livePageView(
      live({ state: 'replay', status: 'recorded', replay: { ...base, materials: [] } }),
      TZ,
      t,
    );
    expect(none.zone).toMatchObject({ state: 'replay', materials: [], completed: true });
    const many = livePageView(
      live({
        state: 'replay',
        status: 'recorded',
        replay: { ...base, materials: Array.from({ length: 10 }, (_, i) => material(i)) },
      }),
      TZ,
      t,
    );
    expect(many.zone).toMatchObject({ materialsCount: '10 arquivos' });
    if (many.zone.state !== 'replay') throw new Error('replay');
    expect(many.zone.materials).toHaveLength(10);
  });

  it('a replay lesson without a video: no player, the missing-recording line', () => {
    const view = livePageView(
      live({
        state: 'replay',
        status: 'recorded',
        replay: {
          lessonId: REPLAY,
          videoAssetId: null,
          videoStatus: 'none',
          durationSeconds: null,
          materials: [],
          progress: { completedAt: null, lastPositionSeconds: 0 },
        },
      }),
      TZ,
      t,
    );
    expect(view.zone).toMatchObject({
      state: 'replay',
      video: null,
      noVideoText: 'Esta live já aconteceu. A gravação não está disponível.',
    });
  });

  it('ended without a replay: the line, and no "Gravada" pill over it (sketch 010 finding 2)', () => {
    const view = livePageView(live({ state: 'ended', status: 'recorded' }), TZ, t);
    expect(view.zone).toEqual({
      state: 'ended',
      text: 'Esta live já aconteceu. A gravação não está disponível.',
    });
    expect(view.statusPill).toBeNull();
    expect(view.refresh).toBeNull();
  });

  it('PR-1: outside the open state the view carries no link, whatever the input holds', () => {
    for (const state of ['before', 'locked', 'cancelled', 'ended'] as const) {
      const view = livePageView(live({ state, joinUrl: 'https://example.test/leak' }), TZ, t);
      expect(JSON.stringify(view), state).not.toContain('example.test');
    }
  });
});

/* ── 08.6-08 — Início (UI-D-448, UI-D-449, D-437, D-440, D-443) ──────────────────────────────── */

const L = '55555555-5555-4555-8555-555555555555';

function hero(overrides: Partial<LearnOverviewHero> = {}): LearnOverviewHero {
  return {
    state: 'retomando',
    courseId: C,
    courseTitle: 'Harmonização facial do zero',
    courseTagline: 'O passo a passo para o primeiro atendimento.',
    coverAssetId: null,
    lessonId: L,
    lessonTitle: 'Pontos de aplicação',
    lessonDurationSeconds: 754,
    moduleNumber: 2,
    moduleTitle: 'Técnica',
    lessonNumber: 3,
    moduleLessonsLeft: 3,
    isFree: false,
    percent: 40,
    done: 6,
    total: 15,
    lessonCount: 15,
    durationSeconds: 130 * 60,
    ...overrides,
  };
}

describe('MEMBER_CATALOGUE_HREF (D-435, UI-D-446)', () => {
  it('is the Cursos body at ?aba=cursos (bare /cursos is Início)', () => {
    expect(MEMBER_CATALOGUE_HREF).toBe('/area-membros?aba=cursos');
  });
});

describe('streakBadgeView (UI-D-448, D-440, D-443)', () => {
  it('zero → the neutral "Sem sequência", inactive', () => {
    expect(streakBadgeView(0, t)).toEqual({
      label: 'Sem sequência',
      ariaLabel: 'Sem sequência de estudo',
      active: false,
    });
  });

  it('a stray negative or non-finite value reads as zero (the web never counts)', () => {
    expect(streakBadgeView(-3, t).active).toBe(false);
    expect(streakBadgeView(Number.NaN, t).label).toBe('Sem sequência');
  });

  it('one day and many days use the ICU plural, tinted', () => {
    expect(streakBadgeView(1, t)).toEqual({
      label: '1 dia',
      ariaLabel: 'Sequência de estudo: 1 dia',
      active: true,
    });
    expect(streakBadgeView(5, t)).toEqual({
      label: '5 dias',
      ariaLabel: 'Sequência de estudo: 5 dias',
      active: true,
    });
    expect(streakBadgeView(999, t).label).toBe('999 dias');
  });

  it('no loss-aversion copy in any label (PR-1)', () => {
    for (const n of [0, 1, 7]) {
      const view = streakBadgeView(n, t);
      expect(`${view.label} ${view.ariaLabel}`).not.toMatch(/perca|perder|meia-noite|quebr/i);
    }
  });
});

describe('homeHeroView (UI-D-449, D-437, COURSE-29)', () => {
  it('retomando: title, eyebrow with two-digit numbers, module-left line, bar, "Continuar aula"', () => {
    const view = homeHeroView(hero(), t);
    expect(view.sectionTitle).toBe('Continue de onde parou');
    expect(view.eyebrow).toBe('Harmonização facial do zero · Módulo 02 · Aula 03');
    expect(view.title).toBe('Pontos de aplicação');
    expect(view.subLine).toBe('Faltam 3 aulas para fechar o módulo “Técnica”.');
    expect(view.bar).toEqual({ percent: 40, label: '40% concluído' });
    expect(view.progressLine).toBe('40% do curso · 6 de 15 aulas');
    expect(view.cta).toEqual({
      label: 'Continuar aula',
      href: `/cursos/${C}/aulas/${L}`,
      play: true,
    });
    expect(view.duration).toBe('12:34');
    expect(view.badge).toBeNull();
  });

  it('retomando with one lesson left uses the singular', () => {
    expect(homeHeroView(hero({ moduleLessonsLeft: 1 }), t).subLine).toBe(
      'Falta 1 aula para fechar o módulo “Técnica”.',
    );
  });

  it('comecando: the tagline, the 0% line and "Assistir à primeira aula"', () => {
    const view = homeHeroView(
      hero({ state: 'comecando', percent: 0, done: 0, moduleNumber: 1, lessonNumber: 1 }),
      t,
    );
    expect(view.sectionTitle).toBe('Comece por aqui');
    expect(view.eyebrow).toBe('Harmonização facial do zero · Módulo 01 · Aula 01');
    expect(view.subLine).toBe('O passo a passo para o primeiro atendimento.');
    expect(view.bar).toBeNull();
    expect(view.progressLine).toBe('15 aulas · 2 h 10 min');
    expect(view.cta.label).toBe('Assistir à primeira aula');
    expect(view.cta.play).toBe(true);
  });

  it('comecando with an empty tagline has no sub-line; no ready video drops the duration', () => {
    const view = homeHeroView(
      hero({
        state: 'comecando',
        percent: 0,
        courseTagline: '  ',
        durationSeconds: 0,
        lessonDurationSeconds: null,
      }),
      t,
    );
    expect(view.subLine).toBeNull();
    expect(view.progressLine).toBe('15 aulas');
    expect(view.duration).toBeNull();
  });

  it('em_dia with a free lesson: "Você está em dia", the badge and "Assistir à aula aberta"', () => {
    const view = homeHeroView(hero({ state: 'em_dia', isFree: true, percent: 0, done: 0 }), t);
    expect(view.sectionTitle).toBe('Você está em dia');
    expect(view.subLine).toBe('Você concluiu tudo que está liberado. O próximo passo é este.');
    expect(view.badge).toBe('Aula aberta');
    expect(view.cta).toEqual({
      label: 'Assistir à aula aberta',
      href: `/cursos/${C}/aulas/${L}`,
      play: true,
    });
  });

  it('em_dia without a lesson: "Conhecer o curso" to the course page, no Play, no eyebrow', () => {
    const view = homeHeroView(
      hero({
        state: 'em_dia',
        lessonId: null,
        lessonTitle: null,
        lessonDurationSeconds: null,
        moduleNumber: null,
        moduleTitle: null,
        lessonNumber: null,
        moduleLessonsLeft: 0,
        isFree: false,
      }),
      t,
    );
    expect(view.cta).toEqual({ label: 'Conhecer o curso', href: `/cursos/${C}`, play: false });
    expect(view.eyebrow).toBeNull();
    expect(view.title).toBe('Harmonização facial do zero');
    expect(view.duration).toBeNull();
    expect(view.badge).toBeNull();
  });

  it('the preview keeps ver=aluno on the CTA', () => {
    expect(homeHeroView(hero(), t, { preview: true }).cta.href).toBe(
      `/cursos/${C}/aulas/${L}?ver=aluno`,
    );
    expect(
      homeHeroView(hero({ state: 'em_dia', lessonId: null }), t, { preview: true }).cta.href,
    ).toBe(`/cursos/${C}?ver=aluno`);
  });
});

/* ── 08.6-09: Início sections ─────────────────────────────────────────────────────────────────── */

const TRACK = '66666666-6666-4666-8666-666666666666';

function shelfItem(overrides: Partial<LearnShelfItem> = {}): LearnShelfItem {
  return {
    courseId: C,
    title: 'Olhar do zero',
    coverAssetId: null,
    kind: 'em_andamento',
    percent: 20,
    done: 3,
    total: 15,
    lessonCount: 15,
    durationSeconds: 7800,
    ...overrides,
  };
}

describe('shelfRowView (UI-D-450, D-436, COURSE-30)', () => {
  it('em_andamento: the bar, "{percent}% · {done} de {total} aulas" and "{course}, {percent}% concluído"', () => {
    const view = shelfRowView(shelfItem(), t);
    expect(view.href).toBe(`/cursos/${C}`);
    expect(view.kind).toBe('em_andamento');
    expect(view.legend).toBe('20% · 3 de 15 aulas');
    expect(view.bar).toEqual({ percent: 20, label: '20% concluído' });
    expect(view.ariaLabel).toBe('Olhar do zero, 20% concluído');
  });

  it('proximo_da_trilha: "Próximo da sua trilha · {N} aulas", no bar, pluralised', () => {
    const view = shelfRowView(
      shelfItem({ kind: 'proximo_da_trilha', percent: 0, done: 0, lessonCount: 8 }),
      t,
    );
    expect(view.legend).toBe('Próximo da sua trilha · 8 aulas');
    expect(view.bar).toBeNull();
    expect(view.ariaLabel).toBe('Olhar do zero, próximo da sua trilha');
    expect(shelfRowView(shelfItem({ kind: 'proximo_da_trilha', lessonCount: 1 }), t).legend).toBe(
      'Próximo da sua trilha · 1 aula',
    );
  });

  it('nao_iniciado: "{N} aulas · {duration}", and the duration omitted at zero (UI-D-410)', () => {
    expect(shelfRowView(shelfItem({ kind: 'nao_iniciado', percent: 0, done: 0 }), t).legend).toBe(
      '15 aulas · 2 h 10 min',
    );
    const noVideo = shelfRowView(
      shelfItem({ kind: 'nao_iniciado', lessonCount: 6, durationSeconds: 0 }),
      t,
    );
    expect(noVideo.legend).toBe('6 aulas');
    expect(noVideo.ariaLabel).toBe('Olhar do zero, não iniciado');
    expect(
      shelfRowView(shelfItem({ kind: 'nao_iniciado', lessonCount: 1, durationSeconds: 0 }), t)
        .legend,
    ).toBe('1 aula');
  });

  it('bloqueado: "Exclusivo · {N} aulas", never "Premium" (D-421, PR-5)', () => {
    const view = shelfRowView(
      shelfItem({ kind: 'bloqueado', percent: 0, done: 0, lessonCount: 6 }),
      t,
    );
    expect(view.legend).toBe('Exclusivo · 6 aulas');
    expect(view.ariaLabel).toBe('Olhar do zero, exclusivo');
    expect(view.bar).toBeNull();
    expect(`${view.legend} ${view.ariaLabel}`).not.toMatch(
      /premium|últimas|vagas|corra|agora mesmo/i,
    );
  });

  it('concluido: "Concluído · {total} aulas" and the "concluído" state', () => {
    const view = shelfRowView(shelfItem({ kind: 'concluido', percent: 100, done: 15 }), t);
    expect(view.legend).toBe('Concluído · 15 aulas');
    expect(view.ariaLabel).toBe('Olhar do zero, concluído');
    expect(view.bar).toBeNull();
    expect(shelfRowView(shelfItem({ kind: 'concluido', total: 1 }), t).legend).toBe(
      'Concluído · 1 aula',
    );
  });

  it('keeps the cover id as sent and keeps ver=aluno in preview', () => {
    const K2 = '77777777-7777-4777-8777-777777777777';
    const view = shelfRowView(shelfItem({ coverAssetId: K2 }), t, true);
    expect(view.coverAssetId).toBe(K2);
    expect(view.href).toBe(`/cursos/${C}?ver=aluno`);
  });
});

function overviewTrack(overrides: Partial<LearnOverviewTrack> = {}): LearnOverviewTrack {
  return {
    id: TRACK,
    title: 'Do zero à prática',
    coverAssetId: null,
    suggested: false,
    percent: 35,
    total: 4,
    coursesDone: 1,
    currentIndex: 2,
    currentCourseTitle: 'Olhar do zero',
    resumeCourseId: C,
    lastLockedCourseTitle: null,
    ...overrides,
  };
}

describe('homeTrackView (UI-D-451, D-438, COURSE-31)', () => {
  it('started: "Etapa n de N", the bar and "{percent}% do caminho · agora: {course}"', () => {
    const view = homeTrackView(overviewTrack(), t);
    expect(view.state).toBe('started');
    expect(view.href).toBe(`/cursos/${C}`);
    expect(view.seeAllHref).toBe('/area-membros?aba=trilhas');
    expect(view.eyebrow).toBe('Etapa 2 de 4');
    expect(view.bar).toEqual({ percent: 35, label: '35% concluído' });
    expect(view.line).toBe('35% do caminho · agora: Olhar do zero');
    expect(view.suggestedPill).toBeNull();
    expect(view.lastLocked).toBeNull();
  });

  it('suggested: the "Sugerido" pill, no bar at 0% and "{total} etapas · comece por {course}"', () => {
    const view = homeTrackView(
      overviewTrack({ suggested: true, percent: 0, coursesDone: 0, currentIndex: 1 }),
      t,
    );
    expect(view.state).toBe('suggested');
    expect(view.suggestedPill).toBe('Sugerido');
    expect(view.bar).toBeNull();
    expect(view.eyebrow).toBe('Etapa 1 de 4');
    expect(view.line).toBe('4 etapas · comece por Olhar do zero');
    expect(
      homeTrackView(
        overviewTrack({ suggested: true, total: 1, coursesDone: 0, currentIndex: 1 }),
        t,
      ).line,
    ).toBe('1 etapa · comece por Olhar do zero');
  });

  it('complete is keyed on coursesDone === total, not on percent 100 (08.6-04)', () => {
    const view = homeTrackView(overviewTrack({ percent: 97, coursesDone: 4, currentIndex: 4 }), t);
    expect(view.state).toBe('done');
    expect(view.line).toBe('Trilha concluída · 4 etapas');
    expect(view.eyebrow).toBe('Etapa 4 de 4');
    expect(homeTrackView(overviewTrack({ percent: 100, coursesDone: 3 }), t).state).toBe('started');
  });

  it('the dashed hook only with lastLockedCourseTitle; a blank one draws nothing', () => {
    expect(
      homeTrackView(overviewTrack({ lastLockedCourseTitle: 'Lábios: técnica e segurança' }), t)
        .lastLocked,
    ).toBe('Lábios: técnica e segurança');
    expect(homeTrackView(overviewTrack({ lastLockedCourseTitle: '  ' }), t).lastLocked).toBeNull();
  });

  it('keeps ver=aluno on the card and on "Ver tudo" in preview', () => {
    const view = homeTrackView(overviewTrack(), t, true);
    expect(view.href).toBe(`/cursos/${C}?ver=aluno`);
    expect(view.seeAllHref).toBe('/area-membros?aba=trilhas&ver=aluno');
    expect(memberTracksHref()).toBe('/area-membros?aba=trilhas');
  });
});

function newLesson(overrides: Partial<LearnNewLesson> = {}): LearnNewLesson {
  return {
    lessonId: L,
    courseId: C,
    courseTitle: 'Pele: protocolo',
    title: 'Limpeza e preparo da pele',
    durationSeconds: 490,
    coverAssetId: null,
    done: false,
    ...overrides,
  };
}

describe('newLessonView (UI-D-454, COURSE-33)', () => {
  it('links to the lesson with the "Nova" badge, the mm:ss chip and "{course} · {duration}"', () => {
    const view = newLessonView(newLesson(), t);
    expect(view.href).toBe(`/cursos/${C}/aulas/${L}`);
    expect(view.badge).toBe('Nova');
    expect(view.duration).toBe('8:10');
    expect(view.meta).toBe('Pele: protocolo · 8 min');
    expect(view.done).toBe(false);
    expect(view.ariaLabel).toBe('Limpeza e preparo da pele, Pele: protocolo');
  });

  it('a done lesson says ", concluída" in its name', () => {
    const view = newLessonView(newLesson({ done: true }), t);
    expect(view.done).toBe(true);
    expect(view.ariaLabel).toBe('Limpeza e preparo da pele, Pele: protocolo, concluída');
  });

  it('without a ready video: no chip, and the meta is the course alone', () => {
    for (const durationSeconds of [null, 0]) {
      const view = newLessonView(newLesson({ durationSeconds }), t);
      expect(view.duration).toBeNull();
      expect(view.meta).toBe('Pele: protocolo');
    }
  });

  it('keeps ver=aluno in preview', () => {
    expect(newLessonView(newLesson(), t, true).href).toBe(`/cursos/${C}/aulas/${L}?ver=aluno`);
  });
});

function categoryTile(overrides: Partial<LearnCategoryTile> = {}): LearnCategoryTile {
  return { id: K, name: 'Harmonização', count: 3, coverAssetId: null, ...overrides };
}

describe('categoryTileView (UI-D-455, COURSE-34, T-08.6-26)', () => {
  it("lands on the catalogue filtered by the server's category id, with the pluralised count", () => {
    const view = categoryTileView(categoryTile(), t);
    expect(view.href).toBe(`/area-membros?aba=cursos&categoria=${K}`);
    expect(view.name).toBe('Harmonização');
    expect(view.count).toBe('3 cursos');
    expect(view.ariaLabel).toBe('Harmonização, 3 cursos');
  });

  it('one course is singular', () => {
    const view = categoryTileView(categoryTile({ count: 1 }), t);
    expect(view.count).toBe('1 curso');
    expect(view.ariaLabel).toBe('Harmonização, 1 curso');
  });

  it('adds &ver=aluno in preview and URL-encodes the id', () => {
    expect(categoryTileView(categoryTile(), t, true).href).toBe(
      `/area-membros?aba=cursos&categoria=${K}&ver=aluno`,
    );
    expect(categoryTileView(categoryTile({ id: 'a b&c' }), t).href).toBe(
      '/area-membros?aba=cursos&categoria=a+b%26c',
    );
  });
});

/* ── 08.6-10: Trilhas (D-439, D-438, UI-D-456, A-UI-11, COURSE-35, T-08.6-20) ───────────────── */

const TA = 'a1111111-1111-4111-8111-111111111111';
const TB = 'b2222222-2222-4222-8222-222222222222';
const TC = 'c3333333-3333-4333-8333-333333333333';
const S1 = 'd4444444-4444-4444-8444-444444444444';
const S2 = 'e5555555-5555-4555-8555-555555555555';

function trackCourse(overrides: Partial<LearnTrackCourse> = {}): LearnTrackCourse {
  return {
    id: S1,
    title: 'Olhar do zero',
    coverAssetId: null,
    state: 'a_seguir',
    locked: false,
    lessonCount: 15,
    durationSeconds: 2 * 3600,
    done: 0,
    percent: 0,
    ...overrides,
  };
}

function learnTrack(overrides: Partial<LearnTrack> = {}): LearnTrack {
  return {
    id: TA,
    title: 'Do zero à prática',
    coverAssetId: null,
    percent: 0,
    coursesDone: 0,
    total: 2,
    currentIndex: 1,
    lessonCount: 21,
    durationSeconds: 3 * 3600,
    resumeCourseId: S1,
    mine: false,
    suggested: false,
    courses: [trackCourse(), trackCourse({ id: S2, title: 'Pele', lessonCount: 6 })],
    ...overrides,
  };
}

describe('selectedTrackId (UI-D-456, planning decision 2, T-08.6-20)', () => {
  const first = learnTrack({ id: TA });
  const suggested = learnTrack({ id: TB, suggested: true });
  const tracks = [first, suggested, learnTrack({ id: TC, mine: true })];

  it('a ?trilha= naming a track of the answer selects it', () => {
    expect(selectedTrackId(tracks, TA)).toBe(TA);
    expect(selectedTrackId(tracks, TB)).toBe(TB);
  });

  it('without a param the mine track wins, then the suggested one, then the first', () => {
    expect(selectedTrackId(tracks, undefined)).toBe(TC);
    expect(selectedTrackId([first, suggested], undefined)).toBe(TB);
    expect(selectedTrackId([first], undefined)).toBe(TA);
  });

  it('an unknown, foreign or repeated ?trilha= reads as the default', () => {
    expect(selectedTrackId(tracks, 'xyz')).toBe(TC);
    expect(selectedTrackId(tracks, '99999999-9999-4999-8999-999999999999')).toBe(TC);
    expect(selectedTrackId(tracks, [TA, TB])).toBe(TC);
    expect(selectedTrackId(tracks, '')).toBe(TC);
  });

  it('no track → null', () => {
    expect(selectedTrackId([], TA)).toBeNull();
    expect(trackTabView([], undefined, t)).toBeNull();
  });
});

describe('trackStepView (D-439, UI-D-456, A-UI-11)', () => {
  it('concluida → the done disc, "Etapa 01 · Concluída", the meta with the duration, no bar', () => {
    const step = trackStepView(trackCourse({ state: 'concluida', done: 15, percent: 100 }), 0, t);
    expect(step.disc).toBe('done');
    expect(step.eyebrow).toBe('Etapa 01 · Concluída');
    expect(step.meta).toBe('15 aulas · 2 h');
    expect(step.progress).toBeNull();
    expect(step.locked).toBe(false);
    expect(step.ariaLabel).toBe('Etapa 01: Olhar do zero, concluída');
    expect(step.href).toBe(`/cursos/${S1}`);
  });

  it('em_andamento → the current disc with its numeral, the bar and "{percent}% · {done} de {total} aulas"', () => {
    const step = trackStepView(trackCourse({ state: 'em_andamento', done: 3, percent: 20 }), 1, t);
    expect(step.disc).toBe('current');
    expect(step.numeral).toBe('02');
    expect(step.eyebrow).toBe('Etapa 02 · Em andamento');
    expect(step.progress).toEqual({
      percent: 20,
      label: '20% concluído',
      line: '20% · 3 de 15 aulas',
    });
    expect(step.ariaLabel).toBe('Etapa 02: Olhar do zero, em andamento');
  });

  it('a_seguir → the next disc; without a ready video the duration is omitted (E10 partial)', () => {
    const step = trackStepView(trackCourse({ durationSeconds: 0, lessonCount: 1 }), 2, t);
    expect(step.disc).toBe('next');
    expect(step.eyebrow).toBe('Etapa 03 · A seguir');
    expect(step.meta).toBe('1 aula');
    expect(step.ariaLabel).toBe('Etapa 03: Olhar do zero, a seguir');
  });

  it('bloqueada → the locked disc, "Exclusivo · {N} aulas", and STILL a link to /cursos/{id} (D-421, D-424)', () => {
    const step = trackStepView(
      trackCourse({ id: S2, state: 'bloqueada', locked: true, lessonCount: 6 }),
      3,
      t,
      true,
    );
    expect(step.disc).toBe('locked');
    expect(step.locked).toBe(true);
    expect(step.eyebrow).toBe('Etapa 04 · Bloqueada');
    expect(step.meta).toBe('Exclusivo · 6 aulas');
    expect(step.href).toBe(`/cursos/${S2}?ver=aluno`);
    expect(step.ariaLabel).toBe('Etapa 04: Olhar do zero, bloqueada');
  });

  it('a course completed before its access was revoked reads concluida (the server says so)', () => {
    const step = trackStepView(
      trackCourse({ state: 'concluida', locked: true, done: 15, percent: 100 }),
      0,
      t,
    );
    expect(step.disc).toBe('done');
    expect(step.meta).toBe('15 aulas · 2 h');
  });
});

describe('trackTabView (D-439, D-438, UI-D-456, COURSE-35)', () => {
  it('a suggested track at 0% → "Sugerido", "Começar trilha", no bar', () => {
    const view = trackTabView([learnTrack({ suggested: true })], undefined, t);
    expect(view?.selected.pill).toEqual({ kind: 'suggested', label: 'Sugerido' });
    expect(view?.selected.cta).toEqual({
      kind: 'start',
      label: 'Começar trilha',
      href: `/cursos/${S1}`,
    });
    expect(view?.selected.bar).toBeNull();
    expect(view?.selected.eyebrow).toBe('Etapa 1 de 2');
    expect(view?.selected.line).toBe('0 de 2 etapas · 0% do caminho');
    expect(view?.others).toEqual([]);
  });

  it('mid-way, mine → "Sua trilha", "Continuar trilha" to resumeCourseId, the bar and the line', () => {
    const view = trackTabView(
      [
        learnTrack({
          mine: true,
          percent: 35,
          coursesDone: 1,
          total: 4,
          currentIndex: 2,
          resumeCourseId: S2,
        }),
      ],
      undefined,
      t,
      true,
    );
    expect(view?.selected.pill).toEqual({ kind: 'mine', label: 'Sua trilha' });
    expect(view?.selected.cta).toEqual({
      kind: 'continue',
      label: 'Continuar trilha',
      href: `/cursos/${S2}?ver=aluno`,
    });
    expect(view?.selected.bar).toEqual({ percent: 35, label: '35% concluído' });
    expect(view?.selected.eyebrow).toBe('Etapa 2 de 4');
    expect(view?.selected.line).toBe('1 de 4 etapas · 35% do caminho');
    expect(view?.selected.pathAria).toBe('O caminho: Do zero à prática');
    expect(view?.selected.steps.map((step) => step.eyebrow)).toEqual([
      'Etapa 01 · A seguir',
      'Etapa 02 · A seguir',
    ]);
  });

  it('every course done → outline "Rever a trilha", keyed on coursesDone and not on percent', () => {
    const done = trackTabView(
      [learnTrack({ mine: true, percent: 100, coursesDone: 2, total: 2, currentIndex: 2 })],
      undefined,
      t,
    );
    expect(done?.selected.cta.kind).toBe('review');
    expect(done?.selected.cta.label).toBe('Rever a trilha');
    expect(done?.selected.eyebrow).toBe('Etapa 2 de 2');

    // 08.6-04: a zero-lesson course keeps the path at 1 of 2 while the lesson-weighted percent is 100.
    const notYet = trackTabView(
      [learnTrack({ mine: true, percent: 100, coursesDone: 1, total: 2, currentIndex: 2 })],
      undefined,
      t,
    );
    expect(notYet?.selected.cta.kind).toBe('continue');
  });

  it('another track chosen by ?trilha= has no pill; the rest become "Outras trilhas" in the answer order', () => {
    const tracks = [
      learnTrack({ id: TA, mine: true, percent: 40 }),
      learnTrack({ id: TB, title: 'Avançado' }),
      learnTrack({ id: TC, title: 'Consultório' }),
    ];
    const view = trackTabView(tracks, TB, t);
    expect(view?.selected.id).toBe(TB);
    expect(view?.selected.pill).toBeNull();
    expect(view?.selected.cta.kind).toBe('start');
    expect(view?.others.map((other) => other.id)).toEqual([TA, TC]);
    expect(view?.others[0]?.href).toBe(`/area-membros?aba=trilhas&trilha=${TA}`);

    const fallback = trackTabView(tracks, 'nao-existe', t);
    expect(fallback?.selected.id).toBe(TA);
    expect(fallback?.selected.pill?.kind).toBe('mine');
  });
});

describe('otherTrackView (UI-D-456)', () => {
  it('not started → the meta and "Você ainda não começou", no bar', () => {
    const view = otherTrackView(
      learnTrack({ id: TB, total: 3, lessonCount: 30, durationSeconds: 5 * 3600 }),
      t,
    );
    expect(view.meta).toBe('3 etapas · 30 aulas · 5 h');
    expect(view.progress).toBeNull();
    expect(view.notStarted).toBe('Você ainda não começou');
  });

  it('started → the bar and "{percent}% do caminho"; one step pluralises "1 etapa"; preview keeps ver=aluno', () => {
    const view = otherTrackView(
      learnTrack({
        id: TB,
        total: 1,
        lessonCount: 1,
        durationSeconds: 0,
        percent: 40,
        courses: [trackCourse({ state: 'em_andamento', done: 1, percent: 40 })],
      }),
      t,
      true,
    );
    expect(view.meta).toBe('1 etapa · 1 aula');
    expect(view.progress).toEqual({ percent: 40, label: '40% concluído', line: '40% do caminho' });
    expect(view.notStarted).toBeNull();
    expect(view.href).toBe(`/area-membros?aba=trilhas&trilha=${TB}&ver=aluno`);
  });
});

/* ── 08.6-10: Meu progresso (D-440..D-443, UI-D-457, A-UI-12, COURSE-36..38) ─────────────────── */

describe('formatWatched (A-UI-12, D-442)', () => {
  it('under one hour → floored minutes', () => {
    expect(formatWatched(2700, t)).toBe('45 min');
    expect(formatWatched(0, t)).toBe('0 min');
    expect(formatWatched(119, t)).toBe('1 min');
    expect(formatWatched(3599, t)).toBe('59 min');
  });

  it('from one hour → "{h} h" or one pt-BR decimal with a comma', () => {
    expect(formatWatched(3600, t)).toBe('1 h');
    expect(formatWatched(12_600, t)).toBe('3,5 h');
    expect(formatWatched(5400, t)).toBe('1,5 h');
    expect(formatWatched(36_000, t)).toBe('10 h');
  });

  it('a stray negative or non-finite value reads as zero', () => {
    expect(formatWatched(-5, t)).toBe('0 min');
    expect(formatWatched(Number.NaN, t)).toBe('0 min');
  });
});

function myProgress(overrides: Partial<LearnMyProgress> = {}): LearnMyProgress {
  return {
    streakDays: 0,
    lessonsDone: 0,
    lessonsTotal: 60,
    percent: 0,
    secondsWatched: 0,
    coursesDone: 0,
    courses: [],
    ...overrides,
  };
}

describe('progressTabView (UI-D-457, D-440..D-443, E11)', () => {
  it('nothing done → the ring at 0%, the empty card to Início, no numbers and no rows', () => {
    const view = progressTabView(myProgress(), t);
    expect(view.emptySchool).toBe(false);
    expect(view.ring).toEqual({
      percent: 0,
      label: '0%',
      done: '0 de 60 aulas concluídas',
      sub: 'Faltam 60 aulas para concluir a escola inteira.',
    });
    expect(view.empty).toEqual({
      title: 'Seu progresso começa na primeira aula',
      body: 'Assista a uma aula e marque como concluída. Daqui pra frente, tudo fica registrado aqui.',
      cta: { label: 'Começar agora', href: '/area-membros' },
    });
    expect(view.stats).toBeNull();
    expect(view.rows).toEqual([]);
    expect(progressTabView(myProgress(), t, true).empty?.cta.href).toBe('/area-membros?ver=aluno');
  });

  it('an empty school (lessonsTotal = 0) is flagged for the catalogue empty state', () => {
    expect(progressTabView(myProgress({ lessonsTotal: 0 }), t).emptySchool).toBe(true);
  });

  it('streak only (completions in now-archived courses) → the numbers render beside the empty card', () => {
    const view = progressTabView(myProgress({ streakDays: 1 }), t);
    expect(view.empty).not.toBeNull();
    expect(view.stats?.map((stat) => stat.value)).toEqual(['0', '0 min', '0', '1 dia']);
  });

  it('full → the server percent, the four numbers in order and the rows with their trailing state', () => {
    const view = progressTabView(
      myProgress({
        streakDays: 5,
        lessonsDone: 21,
        lessonsTotal: 60,
        percent: 35,
        secondsWatched: 12_600,
        coursesDone: 1,
        courses: [
          {
            id: S1,
            title: 'Olhar do zero',
            coverAssetId: null,
            percent: 100,
            done: 15,
            total: 15,
            locked: false,
          },
          {
            id: S2,
            title: 'Pele',
            coverAssetId: null,
            percent: 20,
            done: 3,
            total: 15,
            locked: false,
          },
          {
            id: TA,
            title: 'Lábios',
            coverAssetId: null,
            percent: 16,
            done: 1,
            total: 6,
            locked: true,
          },
        ],
      }),
      t,
      true,
    );
    expect(view.ring.label).toBe('35%');
    expect(view.ring.done).toBe('21 de 60 aulas concluídas');
    expect(view.ring.sub).toBe('Faltam 39 aulas para concluir a escola inteira.');
    expect(view.empty).toBeNull();
    expect(view.stats).toEqual([
      { key: 'lessons', label: 'Aulas concluídas', value: '21' },
      { key: 'hours', label: 'Horas assistidas', value: '3,5 h' },
      { key: 'courses', label: 'Cursos concluídos', value: '1' },
      { key: 'streak', label: 'Sequência atual', value: '5 dias' },
    ]);
    expect(view.rows.map((row) => row.trailing)).toEqual(['done', 'chevron', 'locked']);
    expect(view.rows[0]?.line).toBe('100% · 15 de 15 aulas');
    expect(view.rows[0]?.href).toBe(`/cursos/${S1}?ver=aluno`);
    expect(view.rows[1]?.ariaLabel).toBe('Pele, 20% concluído');
    expect(view.rows[2]?.ariaLabel).toBe('Lábios, 16% concluído, exclusivo');
    expect(view.rows[2]?.bar).toEqual({ percent: 16, label: '16% concluído' });
  });

  it('plurals: one lesson done, one left, one day; the whole school done', () => {
    const one = progressTabView(
      myProgress({ lessonsDone: 1, lessonsTotal: 2, percent: 50, streakDays: 1 }),
      t,
    );
    expect(one.ring.done).toBe('1 de 2 aulas concluídas');
    expect(one.ring.sub).toBe('Falta 1 aula para concluir a escola inteira.');
    const single = progressTabView(
      myProgress({ lessonsDone: 1, lessonsTotal: 1, percent: 100 }),
      t,
    );
    expect(single.ring.done).toBe('1 de 1 aula concluída');
    expect(single.ring.sub).toBe('Você concluiu a escola inteira. Parabéns!');
  });
});

describe('relativeDayLabel (UI-D-452, UI-D-288: tenant-local dates from serverNow)', () => {
  const SP = 'America/Sao_Paulo';

  it('the same local day reads "Hoje", across the UTC midnight', () => {
    // 21:00 in São Paulo (00:00Z the next UTC day) and a start at 01:00Z: still 22:00 local, today.
    expect(relativeDayLabel('2026-10-17T01:00:00.000Z', '2026-10-17T00:00:00.000Z', SP, t)).toBe(
      'Hoje',
    );
    // 21:00 local on the 16th (00:00Z on the 17th) and a start at 23:30 local on the 16th.
    expect(relativeDayLabel('2026-10-17T02:30:00.000Z', '2026-10-17T00:00:00.000Z', SP, t)).toBe(
      'Hoje',
    );
  });

  it('the next local day reads "Amanhã" even when less than 24 hours away, and a UTC-same-day start can be tomorrow', () => {
    // 23:00 local on the 16th → 01:00 local on the 17th: two hours away, but tomorrow.
    expect(relativeDayLabel('2026-10-17T04:00:00.000Z', '2026-10-17T02:00:00.000Z', SP, t)).toBe(
      'Amanhã',
    );
    // Both on the 17th by the UTC date (which would say "Hoje"); 23:00 local on the 16th → 17:00
    // local on the 17th.
    expect(relativeDayLabel('2026-10-17T20:00:00.000Z', '2026-10-17T02:00:00.000Z', SP, t)).toBe(
      'Amanhã',
    );
  });

  it('later days read "Em {n} dias" by calendar date, not by 24-hour blocks', () => {
    expect(relativeDayLabel('2026-10-18T22:00:00.000Z', '2026-10-16T13:00:00.000Z', SP, t)).toBe(
      'Em 2 dias',
    );
    // 23:59 local on the 16th → 00:01 local on the 19th: barely 48 h, three calendar days.
    expect(relativeDayLabel('2026-10-19T03:01:00.000Z', '2026-10-17T02:59:00.000Z', SP, t)).toBe(
      'Em 3 dias',
    );
  });

  it('the zone matters: the same instants in UTC compare UTC dates', () => {
    expect(relativeDayLabel('2026-10-17T01:00:00.000Z', '2026-10-16T23:00:00.000Z', 'UTC', t)).toBe(
      'Amanhã',
    );
    expect(relativeDayLabel('2026-10-17T01:00:00.000Z', '2026-10-16T23:00:00.000Z', SP, t)).toBe(
      'Hoje',
    );
  });
});

describe('homeLiveView (D-444, D-446, UI-D-452, COURSE-32)', () => {
  const L = '77777777-7777-4777-8777-777777777777';
  const NOW = '2026-10-16T13:00:00.000Z';
  const SP = 'America/Sao_Paulo';

  function overviewLive(overrides: Partial<LearnOverviewLive> = {}): LearnOverviewLive {
    return {
      id: L,
      title: 'Tira-dúvidas de outubro',
      coverAssetId: null,
      startsAt: '2026-10-22T22:00:00.000Z',
      durationMin: 60,
      status: 'scheduled',
      locked: false,
      reminderOn: false,
      ...overrides,
    };
  }

  it('a scheduled live is the next-live card: the relative day, the long when-line, no meta', () => {
    const view = homeLiveView(overviewLive(), NOW, SP, t);
    expect(view.kind).toBe('next');
    expect(view.href).toBe(`/cursos/lives/${L}`);
    expect(view.pill).toBe('Em 6 dias');
    expect(view.whenLine).toBe('quinta, 22 de outubro, 19:00');
    expect(view.meta).toBeNull();
    expect(view.locked).toBe(false);
    expect(view.exclusiveLabel).toBeNull();
    expect(view.title).toBe('Tira-dúvidas de outubro');
  });

  it('a locked next live carries "Exclusiva"; the preview keeps ver=aluno on the link', () => {
    const view = homeLiveView(overviewLive({ locked: true }), NOW, SP, t, true);
    expect(view.exclusiveLabel).toBe('Exclusiva');
    expect(view.locked).toBe(true);
    expect(view.href).toBe(`/cursos/lives/${L}?ver=aluno`);
  });

  it('a live happening now is the live-now row: "Ao vivo agora", "Começou às {time} · {duration} min"', () => {
    const view = homeLiveView(
      overviewLive({ status: 'live', startsAt: '2026-10-16T12:30:00.000Z', durationMin: 90 }),
      NOW,
      SP,
      t,
    );
    expect(view.kind).toBe('now');
    expect(view.pill).toBe('Ao vivo agora');
    expect(view.meta).toBe('Começou às 09:30 · 90 min');
    expect(view.whenLine).toBeNull();
    expect(view.exclusiveLabel).toBeNull();
  });

  it('a locked live happening now reads "Live exclusiva · Começou às {time}"', () => {
    const view = homeLiveView(
      overviewLive({ status: 'live', startsAt: '2026-10-16T12:30:00.000Z', locked: true }),
      NOW,
      SP,
      t,
    );
    expect(view.meta).toBe('Live exclusiva · Começou às 09:30');
    expect(view.locked).toBe(true);
  });

  it('never builds a room link: every href is the live page', () => {
    for (const status of ['live', 'scheduled'] as const) {
      const view = homeLiveView(overviewLive({ status }), NOW, SP, t);
      expect(view.href.startsWith('/cursos/lives/')).toBe(true);
      expect(JSON.stringify(view)).not.toContain('http');
    }
  });
});
