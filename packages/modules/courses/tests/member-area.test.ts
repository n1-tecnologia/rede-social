import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  activeTrack,
  courseProgressOf,
  courseShelf,
  heroResume,
  type MemberCourseRow,
  type MemberLessonRow,
  type MemberLiveCardRow,
  type MemberTrackRow,
  newLessonsOf,
  nextLiveOf,
  trackStates,
} from '../contracts/member-area';

/**
 * 08.6-01 — the member area's pure helpers (D-437, COURSE-29; RESEARCH Pattern 2). They decide over
 * the rows of `app.course_member_lessons()` and the published course rows the service reads; the
 * database decides every lock, these only order and count. The cases are the EP-04 boundary list
 * of the plan's `<flagged_assumptions>`.
 */

const C1 = '10000000-0000-4000-8000-000000000001';
const C2 = '10000000-0000-4000-8000-000000000002';
const C3 = '10000000-0000-4000-8000-000000000003';
const C4 = '10000000-0000-4000-8000-000000000004';
const C5 = '10000000-0000-4000-8000-000000000005';
const TR = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const L = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const T0 = '2026-10-10T12:00:00.000000Z';
const T1 = '2026-10-11T12:00:00.000000Z';
const T2 = '2026-10-12T12:00:00.000000Z';

function course(id: string, overrides: Partial<MemberCourseRow> = {}): MemberCourseRow {
  return {
    id,
    title: `Curso ${id.slice(-1)}`,
    tagline: `Tagline ${id.slice(-1)}`,
    coverAssetId: null,
    publishedAt: T0,
    locked: false,
    ...overrides,
  };
}

/**
 * `count` live lessons of `courseId`, `perModule` per module, in course order. Lesson numbers are
 * `base + i` so two courses never share an id.
 */
function lessons(
  courseId: string,
  count: number,
  base: number,
  perModule = count,
  overrides: Partial<MemberLessonRow> = {},
): MemberLessonRow[] {
  return Array.from({ length: count }, (_, i) => {
    const moduleSeq = Math.floor(i / perModule) + 1;
    return {
      courseId,
      moduleId: M(base + moduleSeq),
      lessonId: L(base + i + 1),
      courseSeq: i + 1,
      moduleSeq,
      lessonTitle: `Aula ${i + 1}`,
      moduleTitle: `Módulo ${moduleSeq}`,
      isFree: false,
      durationSeconds: 600,
      lockReason: null,
      completedAt: null,
      touchedAt: null,
      lessonCreatedAt: T0,
      ...overrides,
    };
  });
}

function patch(
  rows: MemberLessonRow[],
  index: number,
  changes: Partial<MemberLessonRow>,
): MemberLessonRow[] {
  return rows.map((row, i) => (i === index ? { ...row, ...changes } : row));
}

describe('heroResume (D-437)', () => {
  it('no published course → no hero', () => {
    expect(heroResume([], [])).toBeNull();
  });

  it('a published course with zero live lessons is never a hero', () => {
    expect(heroResume([course(C1)], [])).toBeNull();
  });

  it('one unlocked course of 3 lessons and no progress row → comecando at lesson 1', () => {
    const hero = heroResume([course(C1)], lessons(C1, 3, 0));
    expect(hero).toMatchObject({
      state: 'comecando',
      courseId: C1,
      courseTitle: 'Curso 1',
      courseTagline: 'Tagline 1',
      lessonId: L(1),
      lessonTitle: 'Aula 1',
      lessonDurationSeconds: 600,
      moduleNumber: 1,
      moduleTitle: 'Módulo 1',
      lessonNumber: 1,
      moduleLessonsLeft: 3,
      isFree: false,
      percent: 0,
      done: 0,
      total: 3,
      lessonCount: 3,
      durationSeconds: 1800,
    });
  });

  it('lesson 1 touched and complete → retomando at lesson 2 (done 1, percent 33, 2 left)', () => {
    const rows = patch(lessons(C1, 3, 0), 0, { completedAt: T1, touchedAt: T1 });
    const hero = heroResume([course(C1)], rows);
    expect(hero).toMatchObject({
      state: 'retomando',
      courseId: C1,
      lessonId: L(2),
      lessonNumber: 2,
      moduleNumber: 1,
      done: 1,
      total: 3,
      percent: 33,
      moduleLessonsLeft: 2,
    });
  });

  it('the most recently touched row incomplete on lesson 2 → retomando resumes lesson 2', () => {
    let rows = patch(lessons(C1, 3, 0), 0, { completedAt: T0, touchedAt: T0 });
    rows = patch(rows, 1, { touchedAt: T1 });
    expect(heroResume([course(C1)], rows)).toMatchObject({
      state: 'retomando',
      lessonId: L(2),
    });
  });

  it('a touched incomplete lesson that is not open is not resumed: the first open incomplete one is', () => {
    let rows = lessons(C1, 3, 0);
    rows = patch(rows, 0, { touchedAt: T0 });
    rows = patch(rows, 2, { touchedAt: T1, lockReason: 'lesson' });
    expect(heroResume([course(C1)], rows)).toMatchObject({
      state: 'retomando',
      lessonId: L(1),
    });
  });

  it('module numbers: module 1 complete → retomando at module 2, lesson 1 of it', () => {
    let rows = lessons(C1, 4, 0, 2);
    rows = patch(rows, 0, { completedAt: T0, touchedAt: T0 });
    rows = patch(rows, 1, { completedAt: T1, touchedAt: T1 });
    expect(heroResume([course(C1)], rows)).toMatchObject({
      state: 'retomando',
      lessonId: L(3),
      moduleNumber: 2,
      moduleTitle: 'Módulo 2',
      lessonNumber: 1,
      moduleLessonsLeft: 2,
      done: 2,
      total: 4,
      percent: 50,
    });
  });

  it('two started courses touched at the same instant → the smaller course id wins', () => {
    const a = patch(lessons(C1, 3, 0), 0, { touchedAt: T1 });
    const b = patch(lessons(C2, 3, 10), 0, { touchedAt: T1 });
    // Catalogue order puts C2 first: the tie-break is the id, not the catalogue position.
    expect(heroResume([course(C2), course(C1)], [...b, ...a])?.courseId).toBe(C1);
  });

  it('a later touch on the other course switches the hero', () => {
    const a = patch(lessons(C1, 3, 0), 0, { touchedAt: T1 });
    const b = patch(lessons(C2, 3, 10), 0, { touchedAt: T2 });
    expect(heroResume([course(C1), course(C2)], [...a, ...b])).toMatchObject({
      state: 'retomando',
      courseId: C2,
      lessonId: L(11),
    });
  });

  it('the only started course is locked (progress kept after a revocation) → comecando on the unlocked one, never the locked one', () => {
    const locked = patch(lessons(C1, 3, 0, 3, { lockReason: 'purchase' }), 0, {
      touchedAt: T2,
      completedAt: T2,
    });
    const open = lessons(C2, 2, 10);
    const hero = heroResume([course(C1, { locked: true }), course(C2)], [...locked, ...open]);
    expect(hero).toMatchObject({ state: 'comecando', courseId: C2, lessonId: L(11) });
  });

  it('every unlocked course complete and a locked course with an incomplete free lesson → em_dia with that lesson and isFree', () => {
    const done = lessons(C1, 2, 0, 2, { completedAt: T1, touchedAt: T1 });
    let locked = lessons(C2, 3, 10, 3, { lockReason: 'purchase' });
    locked = patch(locked, 1, { isFree: true, lockReason: null });
    const hero = heroResume([course(C1), course(C2, { locked: true })], [...done, ...locked]);
    expect(hero).toMatchObject({
      state: 'em_dia',
      courseId: C2,
      lessonId: L(12),
      lessonNumber: 2,
      isFree: true,
    });
  });

  it('the free lesson complete too → em_dia with lessonId null on the first locked course', () => {
    const done = lessons(C1, 2, 0, 2, { completedAt: T1, touchedAt: T1 });
    let lockedA = lessons(C2, 3, 10, 3, { lockReason: 'purchase' });
    lockedA = patch(lockedA, 1, { isFree: true, lockReason: null, completedAt: T2, touchedAt: T2 });
    const lockedB = lessons(C3, 2, 20, 2, { lockReason: 'purchase' });
    const hero = heroResume(
      [course(C1), course(C2, { locked: true }), course(C3, { locked: true })],
      [...done, ...lockedA, ...lockedB],
    );
    expect(hero).toMatchObject({
      state: 'em_dia',
      courseId: C2,
      lessonId: null,
      lessonTitle: null,
      moduleNumber: null,
      lessonNumber: null,
      moduleLessonsLeft: 0,
      isFree: false,
      done: 1,
      total: 3,
    });
  });

  it('everything locked without a free lesson → em_dia on the first locked course, lessonId null', () => {
    const a = lessons(C1, 2, 0, 2, { lockReason: 'purchase' });
    const b = lessons(C2, 2, 10, 2, { lockReason: 'purchase' });
    const hero = heroResume(
      [course(C1, { locked: true }), course(C2, { locked: true })],
      [...a, ...b],
    );
    expect(hero).toMatchObject({ state: 'em_dia', courseId: C1, lessonId: null });
  });

  it('nothing locked and everything complete → em_dia with lessonId null on the most recently touched course', () => {
    const a = lessons(C1, 2, 0, 2, { completedAt: T2, touchedAt: T2 });
    const b = lessons(C2, 2, 10, 2, { completedAt: T1, touchedAt: T1 });
    const hero = heroResume([course(C2), course(C1), course(C3)], [...a, ...b]);
    expect(hero).toMatchObject({
      state: 'em_dia',
      courseId: C1,
      lessonId: null,
      percent: 100,
      done: 2,
      total: 2,
    });
  });

  it('a published course with zero live lessons is skipped by comecando', () => {
    const hero = heroResume([course(C1), course(C2)], lessons(C2, 2, 10));
    expect(hero).toMatchObject({ state: 'comecando', courseId: C2 });
  });
});

describe('courseProgressOf', () => {
  it('0 of 0 → percent 0 and nextLessonId null', () => {
    expect(courseProgressOf([])).toEqual({ done: 0, total: 0, percent: 0, nextLessonId: null });
  });

  it('2 of 3 → percent 66 (floor)', () => {
    let rows = lessons(C1, 3, 0);
    rows = patch(rows, 0, { completedAt: T0 });
    rows = patch(rows, 1, { completedAt: T1 });
    expect(courseProgressOf(rows)).toEqual({
      done: 2,
      total: 3,
      percent: 66,
      nextLessonId: L(3),
    });
  });

  it('the next lesson skips a completed row and a sequence-locked row', () => {
    let rows = lessons(C1, 4, 0);
    rows = patch(rows, 0, { completedAt: T0 });
    rows = patch(rows, 1, { lockReason: 'module' });
    rows = patch(rows, 2, { lockReason: 'lesson' });
    expect(courseProgressOf(rows).nextLessonId).toBe(L(4));
  });

  it('follows course order, not the array order', () => {
    const rows = lessons(C1, 3, 0).reverse();
    expect(courseProgressOf(rows).nextLessonId).toBe(L(1));
  });
});

/** An active track over `courseIds` in path order. */
function track(n: number, courseIds: string[]): MemberTrackRow {
  return { id: TR(n), title: `Trilha ${n}`, coverAssetId: null, courseIds };
}

const kinds = (items: { courseId: string; kind: string }[]) =>
  items.map((item) => [item.courseId, item.kind]);

describe('courseShelf (D-436, COURSE-30)', () => {
  it('hero excluded; one in progress, the track’s next, one unstarted, one locked → 3 rows in kind order, the locked one dropped', () => {
    // The hero's course is in progress and touched LAST: it would rank first, it never appears.
    const hero = patch(lessons(C1, 2, 0), 0, { touchedAt: T2 });
    const unstarted = lessons(C2, 2, 10);
    const inProgress = patch(lessons(C3, 4, 20), 0, { completedAt: T1, touchedAt: T1 });
    const next = lessons(C4, 3, 30);
    const locked = lessons(C5, 2, 40, 2, { lockReason: 'purchase' });
    const shelf = courseShelf(
      [course(C1), course(C2), course(C3), course(C4), course(C5, { locked: true })],
      [...hero, ...unstarted, ...inProgress, ...next, ...locked],
      track(1, [C4]),
      C1,
    );
    expect(kinds(shelf)).toEqual([
      [C3, 'em_andamento'],
      [C4, 'proximo_da_trilha'],
      [C2, 'nao_iniciado'],
    ]);
  });

  it('an in-progress row carries the course’s progress, size and duration', () => {
    const rows = patch(lessons(C3, 4, 20), 0, { completedAt: T1, touchedAt: T1 });
    const [item] = courseShelf([course(C3, { coverAssetId: C5 })], rows, null, null);
    expect(item).toEqual({
      courseId: C3,
      title: 'Curso 3',
      coverAssetId: C5,
      kind: 'em_andamento',
      percent: 25,
      done: 1,
      total: 4,
      lessonCount: 4,
      durationSeconds: 2400,
    });
  });

  it('EP-05: a course in progress that is also on the track is listed once, as em_andamento, and no proximo_da_trilha row appears', () => {
    const inProgress = patch(lessons(C2, 2, 10), 0, { touchedAt: T1 });
    const shelf = courseShelf(
      [course(C2), course(C3)],
      [...inProgress, ...lessons(C3, 2, 20)],
      track(1, [C2]),
      null,
    );
    expect(kinds(shelf)).toEqual([
      [C2, 'em_andamento'],
      [C3, 'nao_iniciado'],
    ]);
  });

  it('the track’s started course and its locked course leave no proximo_da_trilha row', () => {
    const started = patch(lessons(C2, 2, 10), 0, { touchedAt: T1 });
    const locked = lessons(C4, 2, 30, 2, { lockReason: 'purchase' });
    const shelf = courseShelf(
      [course(C2), course(C3), course(C4, { locked: true })],
      [...started, ...lessons(C3, 2, 20), ...locked],
      track(1, [C2, C4]),
      null,
    );
    expect(kinds(shelf)).toEqual([
      [C2, 'em_andamento'],
      [C3, 'nao_iniciado'],
      [C4, 'bloqueado'],
    ]);
  });

  it('the track’s next course is its first unlocked unstarted course, whatever its catalogue place', () => {
    const started = patch(lessons(C2, 2, 10), 0, { touchedAt: T1 });
    const shelf = courseShelf(
      [course(C4), course(C3), course(C2)],
      [...lessons(C4, 1, 30), ...lessons(C3, 1, 20), ...started],
      track(1, [C2, C3]),
      null,
    );
    expect(kinds(shelf)).toEqual([
      [C2, 'em_andamento'],
      [C3, 'proximo_da_trilha'],
      [C4, 'nao_iniciado'],
    ]);
  });

  it('the hero being the track’s next course leaves no proximo_da_trilha row (the prototype’s push order)', () => {
    const shelf = courseShelf(
      [course(C1), course(C2)],
      [...lessons(C1, 2, 0), ...lessons(C2, 2, 10)],
      track(1, [C1]),
      C1,
    );
    expect(kinds(shelf)).toEqual([[C2, 'nao_iniciado']]);
  });

  it('nothing but locked courses → bloqueado rows in catalogue order, at most 3', () => {
    const lockedCourses = [C3, C1, C4, C2].map((id) => course(id, { locked: true }));
    const rows = [
      ...lessons(C1, 1, 0, 1, { lockReason: 'purchase' }),
      ...lessons(C2, 1, 10, 1, { lockReason: 'purchase' }),
      ...lessons(C3, 1, 20, 1, { lockReason: 'purchase' }),
      ...lessons(C4, 1, 30, 1, { lockReason: 'purchase' }),
    ];
    expect(kinds(courseShelf(lockedCourses, rows, null, null))).toEqual([
      [C3, 'bloqueado'],
      [C1, 'bloqueado'],
      [C4, 'bloqueado'],
    ]);
  });

  it('EP-07: everything complete → concluido by last touch desc, then course id asc', () => {
    const rows = [
      ...lessons(C1, 1, 0, 1, { completedAt: T0, touchedAt: T0 }),
      ...lessons(C2, 1, 10, 1, { completedAt: T2, touchedAt: T2 }),
      ...lessons(C4, 1, 30, 1, { completedAt: T1, touchedAt: T1 }),
      ...lessons(C3, 1, 20, 1, { completedAt: T1, touchedAt: T1 }),
    ];
    const shelf = courseShelf([course(C1), course(C2), course(C4), course(C3)], rows, null, null);
    expect(kinds(shelf)).toEqual([
      [C2, 'concluido'],
      [C3, 'concluido'],
      [C4, 'concluido'],
    ]);
    expect(shelf.every((item) => item.percent === 100)).toBe(true);
  });

  it('EP-07: em_andamento orders by last touch desc then id asc; nao_iniciado keeps the catalogue order', () => {
    const a = patch(lessons(C3, 2, 20), 0, { touchedAt: T1 });
    const b = patch(lessons(C2, 2, 10), 0, { touchedAt: T1 });
    const c = patch(lessons(C4, 2, 30), 0, { touchedAt: T2 });
    expect(
      kinds(courseShelf([course(C3), course(C2), course(C4)], [...a, ...b, ...c], null, null)),
    ).toEqual([
      [C4, 'em_andamento'],
      [C2, 'em_andamento'],
      [C3, 'em_andamento'],
    ]);
    const fresh = [C5, C2, C4].map((id) => course(id));
    const freshRows = [...lessons(C5, 1, 40), ...lessons(C2, 1, 10), ...lessons(C4, 1, 30)];
    expect(kinds(courseShelf(fresh, freshRows, null, null))).toEqual([
      [C5, 'nao_iniciado'],
      [C2, 'nao_iniciado'],
      [C4, 'nao_iniciado'],
    ]);
  });

  it('a locked course with progress (access revoked) is bloqueado, never em_andamento', () => {
    const revoked = patch(lessons(C1, 3, 0, 3, { lockReason: 'purchase' }), 0, {
      completedAt: T1,
      touchedAt: T1,
    });
    const shelf = courseShelf(
      [course(C1, { locked: true }), course(C2)],
      [...revoked, ...lessons(C2, 2, 10)],
      null,
      null,
    );
    expect(kinds(shelf)).toEqual([
      [C2, 'nao_iniciado'],
      [C1, 'bloqueado'],
    ]);
  });

  it('EP-06: one or two eligible courses besides the hero → one or two rows, never padded; none → no row', () => {
    const rows = [...lessons(C1, 1, 0), ...lessons(C2, 1, 10), ...lessons(C3, 1, 20)];
    expect(courseShelf([course(C1), course(C2)], rows, null, C1)).toHaveLength(1);
    expect(courseShelf([course(C1), course(C2), course(C3)], rows, null, C1)).toHaveLength(2);
    expect(courseShelf([course(C1)], rows, null, C1)).toEqual([]);
    expect(courseShelf([], [], null, null)).toEqual([]);
  });

  it('an unlocked course with zero live lessons never appears', () => {
    expect(kinds(courseShelf([course(C1), course(C2)], lessons(C2, 1, 10), null, null))).toEqual([
      [C2, 'nao_iniciado'],
    ]);
  });
});

describe('activeTrack (D-438, COURSE-31)', () => {
  it('no track → null', () => {
    expect(activeTrack([], [course(C1)], lessons(C1, 1, 0))).toBeNull();
  });

  it('EP-09: a track whose courses are all unpublished (absent from the course list) → null', () => {
    expect(activeTrack([track(1, [C4, C5])], [course(C1)], lessons(C1, 1, 0))).toBeNull();
  });

  it('EP-09: none started → the first track in admin order holding a published course, suggested, skipping an unpublished-only track', () => {
    const courses = [course(C1), course(C2), course(C3, { locked: true })];
    const rows = [
      ...lessons(C1, 2, 0),
      ...lessons(C2, 2, 10),
      ...lessons(C3, 2, 20, 2, { lockReason: 'purchase' }),
    ];
    expect(
      activeTrack([track(1, [C5]), track(2, [C2, C3]), track(3, [C1])], courses, rows),
    ).toEqual({
      id: TR(2),
      title: 'Trilha 2',
      coverAssetId: null,
      suggested: true,
      percent: 0,
      total: 2,
      coursesDone: 0,
      currentIndex: 1,
      currentCourseTitle: 'Curso 2',
      resumeCourseId: C2,
      lastLockedCourseTitle: 'Curso 3',
    });
  });

  it('a touched course without a completion does not start its track', () => {
    const touched = patch(lessons(C2, 2, 10), 0, { touchedAt: T1 });
    const picked = activeTrack(
      [track(1, [C1]), track(2, [C2])],
      [course(C1), course(C2)],
      [...lessons(C1, 2, 0), ...touched],
    );
    expect(picked).toMatchObject({ id: TR(1), suggested: true, percent: 0 });
  });

  it('two started tracks at 50% and 20% → the 50% one, wherever it sits in admin order', () => {
    const half = patch(lessons(C1, 2, 0), 0, { completedAt: T1, touchedAt: T1 });
    const fifth = patch(lessons(C2, 5, 10), 0, { completedAt: T1, touchedAt: T1 });
    const picked = activeTrack(
      [track(1, [C2]), track(2, [C1])],
      [course(C1), course(C2)],
      [...half, ...fifth],
    );
    expect(picked).toMatchObject({ id: TR(2), suggested: false, percent: 50 });
  });

  it('EP-08: two started tracks with equal percents → the earlier in admin order', () => {
    const a = patch(lessons(C1, 2, 0), 0, { completedAt: T1, touchedAt: T1 });
    const b = patch(lessons(C2, 2, 10), 0, { completedAt: T1, touchedAt: T1 });
    const picked = activeTrack(
      [track(1, [C2]), track(2, [C1])],
      [course(C1), course(C2)],
      [...a, ...b],
    );
    expect(picked).toMatchObject({ id: TR(1), suggested: false, percent: 50 });
  });

  it('EP-08: a course in two tracks counts in both (the shorter track wins on percent)', () => {
    const shared = patch(lessons(C1, 2, 0), 0, { completedAt: T1, touchedAt: T1 });
    const picked = activeTrack(
      [track(1, [C1, C2]), track(2, [C1])],
      [course(C1), course(C2)],
      [...shared, ...lessons(C2, 2, 10)],
    );
    expect(picked).toMatchObject({ id: TR(2), percent: 50, total: 1 });
  });

  it('EP-10: the percent is lesson-weighted; currentIndex and resumeCourseId name the first incomplete course', () => {
    const done = lessons(C1, 1, 0, 1, { completedAt: T1, touchedAt: T1 });
    const picked = activeTrack(
      [track(1, [C1, C2, C3])],
      [course(C1), course(C2), course(C3)],
      [...done, ...lessons(C2, 3, 10), ...lessons(C3, 1, 20)],
    );
    expect(picked).toMatchObject({
      suggested: false,
      percent: 20,
      total: 3,
      coursesDone: 1,
      currentIndex: 2,
      currentCourseTitle: 'Curso 2',
      resumeCourseId: C2,
      lastLockedCourseTitle: null,
    });
  });

  it('EP-10: every course complete → currentIndex equals total and resume is the first course', () => {
    const rows = [
      ...lessons(C2, 1, 10, 1, { completedAt: T1, touchedAt: T1 }),
      ...lessons(C1, 2, 0, 2, { completedAt: T1, touchedAt: T1 }),
    ];
    expect(activeTrack([track(1, [C2, C1])], [course(C1), course(C2)], rows)).toMatchObject({
      percent: 100,
      total: 2,
      coursesDone: 2,
      currentIndex: 2,
      currentCourseTitle: 'Curso 1',
      resumeCourseId: C2,
    });
  });

  it('lastLockedCourseTitle names the LAST locked incomplete course of the path; a complete locked course does not count', () => {
    const rows = [
      ...lessons(C1, 1, 0, 1, { lockReason: 'purchase' }),
      ...patch(lessons(C2, 2, 10), 0, { completedAt: T1, touchedAt: T1 }),
      ...lessons(C3, 1, 20, 1, { lockReason: 'purchase' }),
      ...lessons(C4, 1, 30, 1, { lockReason: 'purchase', completedAt: T0, touchedAt: T0 }),
    ];
    const courses = [
      course(C1, { locked: true }),
      course(C2),
      course(C3, { locked: true }),
      course(C4, { locked: true }),
    ];
    expect(activeTrack([track(1, [C1, C2, C3, C4])], courses, rows)).toMatchObject({
      lastLockedCourseTitle: 'Curso 3',
    });
  });

  it('EP-10: the path keeps the given order and drops unpublished ids', () => {
    const picked = activeTrack(
      [track(1, [C5, C3, C1])],
      [course(C1), course(C3)],
      [...lessons(C1, 1, 0), ...lessons(C3, 1, 20)],
    );
    expect(picked).toMatchObject({ total: 2, currentCourseTitle: 'Curso 3', resumeCourseId: C3 });
  });
});

const V = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** The request's one instant (the overview's `serverNow`). */
const NOW = new Date('2026-10-16T12:00:00.000Z');
const NONE = new Set<string>();

function live(n: number, startsAt: string, overrides: Partial<MemberLiveCardRow> = {}) {
  return {
    id: V(n),
    title: `Live ${n}`,
    coverAssetId: null,
    startsAt,
    durationMin: 60,
    cancelledAt: null,
    locked: false,
    ...overrides,
  } satisfies MemberLiveCardRow;
}

describe('nextLiveOf (D-444, D-446, COURSE-32)', () => {
  it('no card → null', () => {
    expect(nextLiveOf([], NOW, NONE)).toBeNull();
  });

  it('a live happening now beats a nearer scheduled one, and the answer carries exactly the overview fields', () => {
    const now = live(2, '2026-10-16T11:30:00.000000Z', { coverAssetId: C1 });
    const soon = live(1, '2026-10-16T12:05:00.000000Z');
    expect(nextLiveOf([soon, now], NOW, NONE)).toEqual({
      id: V(2),
      title: 'Live 2',
      coverAssetId: C1,
      startsAt: '2026-10-16T11:30:00.000000Z',
      durationMin: 60,
      status: 'live',
      locked: false,
      reminderOn: false,
    });
  });

  it('several lives happening now → the earliest start, then the smaller id', () => {
    const a = live(3, '2026-10-16T11:00:00.000000Z', { durationMin: 120 });
    const b = live(2, '2026-10-16T11:30:00.000000Z');
    const c = live(1, '2026-10-16T11:00:00.000000Z', { durationMin: 120 });
    expect(nextLiveOf([a, b, c], NOW, NONE)?.id).toBe(V(1));
  });

  it('two scheduled lives → the nearest start; equal starts → the smaller id', () => {
    const far = live(1, '2026-10-18T12:00:00.000000Z');
    const near = live(3, '2026-10-17T12:00:00.000000Z');
    const twin = live(2, '2026-10-17T12:00:00.000000Z');
    expect(nextLiveOf([far, near], NOW, NONE)).toMatchObject({ id: V(3), status: 'scheduled' });
    expect(nextLiveOf([far, near, twin], NOW, NONE)?.id).toBe(V(2));
  });

  it('a cancelled live and a recorded live are never chosen', () => {
    const cancelled = live(1, '2026-10-16T13:00:00.000000Z', {
      cancelledAt: '2026-10-15T10:00:00.000000Z',
    });
    const recorded = live(2, '2026-10-16T09:00:00.000000Z');
    expect(nextLiveOf([cancelled, recorded], NOW, NONE)).toBeNull();
    const later = live(3, '2026-10-20T12:00:00.000000Z');
    expect(nextLiveOf([cancelled, recorded, later], NOW, NONE)?.id).toBe(V(3));
  });

  it('half-open boundaries: AT its start a live is live; AT its planned end it is recorded and absent', () => {
    expect(nextLiveOf([live(1, '2026-10-16T12:00:00.000000Z')], NOW, NONE)?.status).toBe('live');
    expect(nextLiveOf([live(2, '2026-10-16T11:00:00.000000Z')], NOW, NONE)).toBeNull();
  });

  it('a locked live is still chosen and answers locked: true', () => {
    const locked = live(1, '2026-10-17T12:00:00.000000Z', { locked: true });
    expect(nextLiveOf([locked], NOW, NONE)).toMatchObject({ id: V(1), locked: true });
  });

  it('reminderOn reflects only the given set of the caller’s own live ids', () => {
    const next = live(1, '2026-10-17T12:00:00.000000Z');
    expect(nextLiveOf([next], NOW, new Set([V(1)]))?.reminderOn).toBe(true);
    expect(nextLiveOf([next], NOW, new Set([V(2)]))?.reminderOn).toBe(false);
  });
});

/** The week's boundary for NOW: exactly seven days before it. */
const WEEK_AGO = '2026-10-09T12:00:00.000000Z';

describe('newLessonsOf (COURSE-33)', () => {
  it('a purchase-, module- or lesson-locked lesson never appears; an open free lesson of a locked course does', () => {
    let rows = lessons(C1, 4, 0, 4, { lessonCreatedAt: T2 });
    rows = patch(rows, 0, { lockReason: 'purchase' });
    rows = patch(rows, 1, { lockReason: 'module' });
    rows = patch(rows, 2, { lockReason: 'lesson' });
    rows = patch(rows, 3, { isFree: true });
    const items = newLessonsOf([course(C1, { locked: true })], rows, NOW);
    expect(items.map((item) => item.lessonId)).toEqual([L(4)]);
  });

  it('EP-12: a lesson exactly 7 days old is included; 7 days and 1 second old is not', () => {
    let rows = lessons(C1, 2, 0);
    rows = patch(rows, 0, { lessonCreatedAt: WEEK_AGO });
    rows = patch(rows, 1, { lessonCreatedAt: '2026-10-09T11:59:59.000000Z' });
    const items = newLessonsOf(
      [course(C1, { publishedAt: '2026-01-01T00:00:00.000000Z' })],
      rows,
      NOW,
    );
    expect(items.map((item) => item.lessonId)).toEqual([L(1)]);
  });

  it('EP-14: five qualifying lessons → four, newest first, equal dates by lesson id asc', () => {
    const old = '2026-01-01T00:00:00.000000Z';
    let rows = lessons(C1, 5, 0);
    rows = patch(rows, 0, { lessonCreatedAt: '2026-10-10T12:00:00.000000Z' });
    rows = patch(rows, 1, { lessonCreatedAt: '2026-10-15T12:00:00.000000Z' });
    rows = patch(rows, 2, { lessonCreatedAt: '2026-10-12T12:00:00.000000Z' });
    rows = patch(rows, 3, { lessonCreatedAt: '2026-10-15T12:00:00.000000Z' });
    rows = patch(rows, 4, { lessonCreatedAt: '2026-10-11T12:00:00.000000Z' });
    const items = newLessonsOf([course(C1, { publishedAt: old })], rows, NOW);
    expect(items.map((item) => item.lessonId)).toEqual([L(2), L(4), L(3), L(5)]);
  });

  it('EP-13: an old lesson of a course first published today qualifies (new-date = published_at)', () => {
    const rows = lessons(C1, 1, 0, 1, { lessonCreatedAt: '2026-09-01T12:00:00.000000Z' });
    const today = '2026-10-16T08:00:00.000000Z';
    expect(newLessonsOf([course(C1, { publishedAt: today })], rows, NOW)).toHaveLength(1);
    expect(
      newLessonsOf([course(C1, { publishedAt: WEEK_AGO.replace('09T12', '01T12') })], rows, NOW),
    ).toEqual([]);
  });

  it('an item carries the lesson, its course and the caller’s completion', () => {
    const rows = patch(lessons(C1, 1, 0, 1, { lessonCreatedAt: T2 }), 0, {
      completedAt: T2,
      durationSeconds: null,
    });
    expect(newLessonsOf([course(C1, { coverAssetId: C5, publishedAt: T0 })], rows, NOW)).toEqual([
      {
        lessonId: L(1),
        courseId: C1,
        courseTitle: 'Curso 1',
        title: 'Aula 1',
        durationSeconds: null,
        coverAssetId: C5,
        done: true,
      },
    ]);
  });

  it('EP-13: no qualifying lesson → no item; a lesson of a course outside the list → no item', () => {
    expect(newLessonsOf([], [], NOW)).toEqual([]);
    expect(newLessonsOf([course(C2)], lessons(C1, 1, 0, 1, { lessonCreatedAt: T2 }), NOW)).toEqual(
      [],
    );
  });
});

describe('trackStates (D-439, COURSE-35)', () => {
  const states = (view: { courses: { id: string; state: string }[] } | undefined) =>
    (view?.courses ?? []).map((item) => [item.id, item.state]);

  it('a track of three courses (complete, started, untouched) → concluida, em_andamento, a_seguir, with the full view', () => {
    const done = lessons(C1, 1, 0, 1, { completedAt: T1, touchedAt: T1 });
    const started = patch(lessons(C2, 2, 10), 0, { touchedAt: T2 });
    const fresh = lessons(C3, 2, 20, 2, { durationSeconds: null });
    const [view] = trackStates(
      [track(1, [C1, C2, C3])],
      [course(C1), course(C2), course(C3)],
      [...done, ...started, ...fresh],
    );
    expect(view).toEqual({
      id: TR(1),
      title: 'Trilha 1',
      coverAssetId: null,
      percent: 20,
      coursesDone: 1,
      total: 3,
      currentIndex: 2,
      lessonCount: 5,
      durationSeconds: 1800,
      resumeCourseId: C2,
      mine: true,
      suggested: false,
      courses: [
        {
          id: C1,
          title: 'Curso 1',
          coverAssetId: null,
          state: 'concluida',
          locked: false,
          lessonCount: 1,
          durationSeconds: 600,
          done: 1,
          percent: 100,
        },
        {
          id: C2,
          title: 'Curso 2',
          coverAssetId: null,
          state: 'em_andamento',
          locked: false,
          lessonCount: 2,
          durationSeconds: 1200,
          done: 0,
          percent: 0,
        },
        {
          id: C3,
          title: 'Curso 3',
          coverAssetId: null,
          state: 'a_seguir',
          locked: false,
          lessonCount: 2,
          durationSeconds: 0,
          done: 0,
          percent: 0,
        },
      ],
    });
  });

  it('a locked untouched course → bloqueada; a locked completed course → concluida (complete wins); a locked started course → bloqueada', () => {
    const courses = [
      course(C1, { locked: true }),
      course(C2, { locked: true }),
      course(C3, { locked: true }),
    ];
    const rows = [
      ...lessons(C1, 1, 0, 1, { lockReason: 'purchase' }),
      ...lessons(C2, 1, 10, 1, { lockReason: 'purchase', completedAt: T1, touchedAt: T1 }),
      ...patch(lessons(C3, 2, 20, 2, { lockReason: 'purchase' }), 0, {
        completedAt: T1,
        touchedAt: T1,
      }),
    ];
    const [view] = trackStates([track(1, [C1, C2, C3])], courses, rows);
    expect(states(view)).toEqual([
      [C1, 'bloqueada'],
      [C2, 'concluida'],
      [C3, 'bloqueada'],
    ]);
    expect(view?.courses.every((item) => item.locked)).toBe(true);
  });

  it('EP-25: 1 of 3 lessons → 33 and 2 of 3 → 66 (floored)', () => {
    const rows = lessons(C1, 3, 0);
    const one = trackStates([track(1, [C1])], [course(C1)], patch(rows, 0, { completedAt: T1 }));
    expect(one[0]?.percent).toBe(33);
    expect(one[0]?.courses[0]?.percent).toBe(33);
    const two = trackStates(
      [track(1, [C1])],
      [course(C1)],
      patch(patch(rows, 0, { completedAt: T1 }), 1, { completedAt: T1 }),
    );
    expect(two[0]?.percent).toBe(66);
  });

  it('EP-21: every live lesson complete → 100, currentIndex equals total, resume at the first course; no completion → 0', () => {
    const courses = [course(C1), course(C2)];
    const all = [
      ...lessons(C1, 2, 0, 2, { completedAt: T1, touchedAt: T1 }),
      ...lessons(C2, 1, 10, 1, { completedAt: T1, touchedAt: T1 }),
    ];
    const [complete] = trackStates([track(1, [C1, C2])], courses, all);
    expect(complete).toMatchObject({
      percent: 100,
      coursesDone: 2,
      total: 2,
      currentIndex: 2,
      resumeCourseId: C1,
    });
    const [none] = trackStates([track(1, [C1, C2])], courses, [
      ...lessons(C1, 2, 0),
      ...lessons(C2, 1, 10),
    ]);
    expect(none).toMatchObject({ percent: 0, coursesDone: 0, currentIndex: 1, resumeCourseId: C1 });
  });

  it('EP-21: a published course with zero live lessons is never concluida (the lesson-weighted percent counts live lessons only)', () => {
    const [view] = trackStates(
      [track(1, [C1, C2])],
      [course(C1), course(C2)],
      lessons(C1, 1, 0, 1, { completedAt: T1, touchedAt: T1 }),
    );
    expect(states(view)).toEqual([
      [C1, 'concluida'],
      [C2, 'a_seguir'],
    ]);
    expect(view).toMatchObject({
      percent: 100,
      coursesDone: 1,
      currentIndex: 2,
      resumeCourseId: C2,
    });
    expect(view?.courses[1]).toMatchObject({ lessonCount: 0, done: 0, percent: 0 });
  });

  it('D-438: the active started track → mine; the other tracks are neither mine nor suggested', () => {
    const rows = [
      ...lessons(C1, 2, 0),
      ...patch(lessons(C2, 2, 10), 0, { completedAt: T1, touchedAt: T1 }),
    ];
    const views = trackStates([track(1, [C1]), track(2, [C2])], [course(C1), course(C2)], rows);
    expect(views.map((view) => [view.id, view.mine, view.suggested])).toEqual([
      [TR(1), false, false],
      [TR(2), true, false],
    ]);
  });

  it('D-438: with nothing started the first track is suggested and no track is mine', () => {
    const views = trackStates(
      [track(1, [C1]), track(2, [C2])],
      [course(C1), course(C2)],
      [...lessons(C1, 1, 0), ...lessons(C2, 1, 10)],
    );
    expect(views.map((view) => [view.id, view.mine, view.suggested])).toEqual([
      [TR(1), false, true],
      [TR(2), false, false],
    ]);
  });

  it('EP-22: a course in two tracks carries the same state, done and percent in both', () => {
    const rows = [
      ...lessons(C1, 1, 0),
      ...patch(lessons(C2, 3, 10), 0, { completedAt: T1, touchedAt: T1 }),
      ...lessons(C3, 1, 20),
    ];
    const views = trackStates(
      [track(1, [C1, C2]), track(2, [C2, C3])],
      [course(C1), course(C2), course(C3)],
      rows,
    );
    const shared = views.map((view) => view.courses.find((item) => item.id === C2));
    expect(shared[0]).toEqual(shared[1]);
    expect(shared[0]).toMatchObject({ state: 'em_andamento', done: 1, percent: 33 });
  });

  it('EP-23: a track of only unpublished courses is absent; a draft course drops out of a mixed path', () => {
    const views = trackStates(
      [track(1, [C4, C5]), track(2, [C4, C1])],
      [course(C1)],
      lessons(C1, 1, 0),
    );
    expect(views.map((view) => view.id)).toEqual([TR(2)]);
    expect(views[0]).toMatchObject({ total: 1, suggested: true });
    expect(views[0]?.courses.map((item) => item.id)).toEqual([C1]);
  });

  it('EP-23: no track left → an empty list', () => {
    expect(trackStates([], [course(C1)], lessons(C1, 1, 0))).toEqual([]);
    expect(trackStates([track(1, [C4])], [course(C1)], lessons(C1, 1, 0))).toEqual([]);
  });

  it('EP-24: tracks keep the given admin order and each path keeps its path order', () => {
    const views = trackStates(
      [track(3, [C3, C1]), track(1, [C2]), track(2, [C1, C3, C2])],
      [course(C1), course(C2), course(C3)],
      [...lessons(C1, 1, 0), ...lessons(C2, 1, 10), ...lessons(C3, 1, 20)],
    );
    expect(views.map((view) => [view.id, view.courses.map((item) => item.id)])).toEqual([
      [TR(3), [C3, C1]],
      [TR(1), [C2]],
      [TR(2), [C1, C3, C2]],
    ]);
  });
});

describe('purity (R-Pattern 2)', () => {
  it('the helper source reads no clock, no storage and no database', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../contracts/member-area.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/Date\.now|new Date|localStorage|sessionStorage|fetch\(/);
    expect(source).not.toMatch(/from '(drizzle-orm|@rede-social\/core)/);
  });
});
