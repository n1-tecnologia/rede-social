import type {
  CourseLevel,
  LearnCourse,
  LearnCourseCard,
  LearnMyProgress,
  LearnOutlineLesson,
  LearnOverviewHero,
  LearnOverviewTrack,
  LearnShelfItem,
} from '@rede-social/module-courses/contracts';
import { describe, expect, it } from 'vitest';
import { neverStarted, startHero, suggestedStart, swapShelf } from './courses-home-plan';

/**
 * 2026-10-22 — the user's rule for what the member area's Início leads with: the continuation of
 * what the member was watching, else the platform's suggestion (the next course at the member's
 * level, or the initial course), and the catalogue for a member who never started a lesson. The
 * cards are in the API's catalogue order (newest published first), as `getLearnCatalogueAll`
 * returns them.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function card(
  n: number,
  fields: Partial<Omit<LearnCourseCard, 'id'>> & { level?: CourseLevel | null } = {},
): LearnCourseCard {
  return {
    id: id(n),
    title: `Curso ${n}`,
    coverAssetId: null,
    category: null,
    level: null,
    lessonCount: 3,
    durationSeconds: 0,
    completedCount: 0,
    locked: false,
    ...fields,
  };
}

function track(fields: Partial<LearnOverviewTrack> = {}): LearnOverviewTrack {
  return {
    id: id(900),
    title: 'Trilha',
    coverAssetId: null,
    suggested: true,
    percent: 0,
    total: 3,
    coursesDone: 0,
    currentIndex: 1,
    currentCourseTitle: 'Curso',
    resumeCourseId: id(999),
    lastLockedCourseTitle: null,
    ...fields,
  };
}

function progress(fields: Partial<LearnMyProgress> = {}): LearnMyProgress {
  return {
    streakDays: 0,
    lessonsDone: 0,
    lessonsTotal: 12,
    percent: 0,
    secondsWatched: 0,
    coursesDone: 0,
    courses: [],
    ...fields,
  };
}

describe('neverStarted (request 2: nothing started yet → the catalogue)', () => {
  it('is true with no started course and no completed lesson', () => {
    expect(neverStarted(progress())).toBe(true);
  });

  it('a started course (even without a completed lesson) is a start: Início', () => {
    const started = {
      id: id(1),
      title: 'Curso',
      coverAssetId: null,
      percent: 0,
      done: 0,
      total: 3,
      locked: false,
    };
    expect(neverStarted(progress({ courses: [started] }))).toBe(false);
  });

  it('a completed lesson is a start too: Início', () => {
    expect(neverStarted(progress({ lessonsDone: 1 }))).toBe(false);
  });
});

describe('suggestedStart (request 1: nothing in progress → the initial course or the next level)', () => {
  it('without a level anywhere: the course published FIRST (the last card, newest first)', () => {
    const cards = [card(3), card(2), card(1)];
    expect(suggestedStart(cards, null)?.id).toBe(id(1));
  });

  it('without a level: the suggested track’s next course wins (the school’s way in)', () => {
    const cards = [card(3), card(2), card(1)];
    expect(suggestedStart(cards, track({ resumeCourseId: id(2) }))?.id).toBe(id(2));
  });

  it('never suggests a locked, an empty or a touched course', () => {
    const cards = [
      card(4, { locked: true }),
      card(3, { lessonCount: 0 }),
      card(2, { completedCount: 3 }),
      card(1),
    ];
    expect(suggestedStart(cards, null)?.id).toBe(id(1));
    expect(suggestedStart([card(1, { locked: true }), card(2, { completedCount: 1 })], null)).toBe(
      null,
    );
  });

  it('a fresh member starts at iniciante, at the course published first there, whatever is newer', () => {
    const cards = [
      card(5, { level: 'avancado' }),
      card(4, { level: 'iniciante' }),
      card(3, { level: 'intermediario' }),
      card(2, { level: 'iniciante' }),
      card(1, { level: null }),
    ];
    expect(suggestedStart(cards, null)?.id).toBe(id(2));
  });

  it('inside the level, the suggested track’s next course wins over the oldest', () => {
    const cards = [card(4, { level: 'iniciante' }), card(2, { level: 'iniciante' })];
    expect(suggestedStart(cards, track({ resumeCourseId: id(4) }))?.id).toBe(id(4));
  });

  it('a suggested track whose next course is ABOVE the member’s level does not jump the ladder', () => {
    const cards = [card(5, { level: 'avancado' }), card(2, { level: 'iniciante' })];
    expect(suggestedStart(cards, track({ resumeCourseId: id(5) }))?.id).toBe(id(2));
  });

  it('the member’s level is the highest one they completed: that level first, then above, then below, then no level', () => {
    const base = [
      card(9, { level: 'intermediario', completedCount: 3 }),
      card(8, { level: 'iniciante' }),
      card(7, { level: null }),
      card(6, { level: 'avancado' }),
      card(5, { level: 'intermediario' }),
    ];
    expect(suggestedStart(base, null)?.id).toBe(id(5));
    const noMoreIntermediate = base.filter((item) => item.id !== id(5));
    expect(suggestedStart(noMoreIntermediate, null)?.id).toBe(id(6));
    const onlyBelow = noMoreIntermediate.filter((item) => item.id !== id(6));
    expect(suggestedStart(onlyBelow, null)?.id).toBe(id(8));
    const onlyUnlevelled = onlyBelow.filter((item) => item.id !== id(8));
    expect(suggestedStart(onlyUnlevelled, null)?.id).toBe(id(7));
  });

  it('a track the member STARTED leads with its next course, above any level', () => {
    const cards = [card(3, { level: 'avancado' }), card(1, { level: 'iniciante' })];
    expect(suggestedStart(cards, track({ suggested: false, resumeCourseId: id(3) }))?.id).toBe(
      id(3),
    );
  });

  it('a started track whose next course cannot start (locked or touched) falls back to the ladder', () => {
    const cards = [card(3, { locked: true, level: 'iniciante' }), card(1, { level: 'iniciante' })];
    expect(suggestedStart(cards, track({ suggested: false, resumeCourseId: id(3) }))?.id).toBe(
      id(1),
    );
  });
});

function lesson(n: number, fields: Partial<LearnOutlineLesson> = {}): LearnOutlineLesson {
  return {
    id: id(100 + n),
    title: `Aula ${n}`,
    position: n,
    number: n,
    durationSeconds: 60,
    hasVideo: true,
    isFree: false,
    requiresPrevious: false,
    lockReason: null,
    completedAt: null,
    lastPositionSeconds: 0,
    ...fields,
  };
}

function course(fields: Partial<LearnCourse> = {}): LearnCourse {
  return {
    id: id(1),
    title: 'Fundamentos',
    tagline: 'A base de tudo.',
    description: '',
    coverAssetId: id(50),
    category: null,
    level: 'iniciante',
    instructorName: 'Instrutora',
    instructorPhotoAssetId: null,
    outcomes: [],
    certificateHours: null,
    locked: false,
    modules: [
      {
        id: id(200),
        title: 'Módulo A',
        position: 1,
        number: 1,
        requiresPrevious: false,
        lockReason: null,
        lessons: [lesson(1, { isFree: true }), lesson(2, { durationSeconds: null })],
      },
      {
        id: id(201),
        title: 'Módulo B',
        position: 2,
        number: 2,
        requiresPrevious: false,
        lockReason: null,
        lessons: [lesson(3, { number: 1 })],
      },
    ],
    progress: {
      done: 0,
      total: 3,
      percent: 0,
      nextLessonId: id(101),
      firstLessonId: id(101),
      firstFreeLessonId: id(101),
    },
    ...fields,
  };
}

describe('startHero (the suggested course drawn as the API’s comecando card)', () => {
  it('fills the card from the course page’s outline at its next open lesson', () => {
    expect(startHero(course())).toEqual({
      state: 'comecando',
      courseId: id(1),
      courseTitle: 'Fundamentos',
      courseTagline: 'A base de tudo.',
      coverAssetId: id(50),
      lessonId: id(101),
      lessonTitle: 'Aula 1',
      lessonDurationSeconds: 60,
      moduleNumber: 1,
      moduleTitle: 'Módulo A',
      lessonNumber: 1,
      moduleLessonsLeft: 2,
      isFree: true,
      percent: 0,
      done: 0,
      total: 3,
      lessonCount: 3,
      durationSeconds: 120,
    });
  });

  it('a lesson in a later module carries that module’s number and the lesson’s own rank', () => {
    const hero = startHero(
      course({
        progress: {
          done: 2,
          total: 3,
          percent: 66,
          nextLessonId: id(103),
          firstLessonId: id(101),
          firstFreeLessonId: null,
        },
      }),
    );
    expect(hero).toMatchObject({ moduleNumber: 2, moduleTitle: 'Módulo B', lessonNumber: 1 });
  });

  it('is null for a locked course or a course with no open lesson left', () => {
    expect(startHero(course({ locked: true }))).toBe(null);
    expect(
      startHero(
        course({
          progress: {
            done: 3,
            total: 3,
            percent: 100,
            nextLessonId: null,
            firstLessonId: id(101),
            firstFreeLessonId: null,
          },
        }),
      ),
    ).toBe(null);
  });
});

function shelfRow(n: number, kind: LearnShelfItem['kind']): LearnShelfItem {
  return {
    courseId: id(n),
    title: `Curso ${n}`,
    coverAssetId: null,
    kind,
    percent: 0,
    done: 0,
    total: 2,
    lessonCount: 2,
    durationSeconds: 0,
  };
}

const displaced: LearnOverviewHero = {
  state: 'comecando',
  courseId: id(7),
  courseTitle: 'Curso 7',
  courseTagline: '',
  coverAssetId: null,
  lessonId: id(170),
  lessonTitle: 'Aula',
  lessonDurationSeconds: null,
  moduleNumber: 1,
  moduleTitle: 'Módulo',
  lessonNumber: 1,
  moduleLessonsLeft: 2,
  isFree: false,
  percent: 0,
  done: 0,
  total: 2,
  lessonCount: 2,
  durationSeconds: 90,
};

describe('swapShelf ("Meus cursos" after the hero changed course)', () => {
  it('the new hero leaves the shelf and the displaced course comes back first among the unstarted', () => {
    const rows = swapShelf(
      [shelfRow(2, 'proximo_da_trilha'), shelfRow(3, 'nao_iniciado'), shelfRow(4, 'bloqueado')],
      id(3),
      displaced,
      null,
    );
    expect(rows?.map((row) => [row.courseId, row.kind])).toEqual([
      [id(2), 'proximo_da_trilha'],
      [id(7), 'nao_iniciado'],
      [id(4), 'bloqueado'],
    ]);
    expect(rows?.[1]).toMatchObject({ title: 'Curso 7', lessonCount: 2, durationSeconds: 90 });
  });

  it('the displaced course that is the track’s next course comes back as proximo_da_trilha, right after the courses in progress', () => {
    const rows = swapShelf(
      [shelfRow(2, 'em_andamento'), shelfRow(3, 'nao_iniciado')],
      id(3),
      displaced,
      track({ resumeCourseId: id(7) }),
    );
    expect(rows?.map((row) => [row.courseId, row.kind])).toEqual([
      [id(2), 'em_andamento'],
      [id(7), 'proximo_da_trilha'],
    ]);
  });

  it('a full shelf keeps three rows (the cascade’s last one gives way)', () => {
    const rows = swapShelf(
      [shelfRow(2, 'nao_iniciado'), shelfRow(3, 'nao_iniciado'), shelfRow(4, 'bloqueado')],
      id(9),
      displaced,
      null,
    );
    expect(rows?.map((row) => row.courseId)).toEqual([id(7), id(2), id(3)]);
  });

  it('an absent shelf gets the displaced course alone', () => {
    expect(swapShelf(undefined, id(9), displaced, null)?.map((row) => row.courseId)).toEqual([
      id(7),
    ]);
  });
});
