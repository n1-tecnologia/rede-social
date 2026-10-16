import { fileURLToPath } from 'node:url';
import type {
  LearnCourse,
  LearnCourseCard,
  LearnLesson,
  LearnLive,
  LearnLiveCard,
  LearnOutlineLesson,
  LearnOutlineModule,
} from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import {
  catalogueCategoryHref,
  categoryFromParam,
  courseAccessById,
  courseActionView,
  courseCardTags,
  courseCardView,
  courseHeroView,
  coursePercent,
  courseSeconds,
  curriculumOpenModules,
  curriculumView,
  isPreview,
  lessonLockView,
  lessonNavView,
  lessonPageView,
  liveAccessById,
  liveCardView,
  livePageView,
  MEMBER_LIVES_HREF,
  memberLessonRowView,
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
    expect(MEMBER_LIVES_HREF).toBe('/cursos?aba=lives');
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
