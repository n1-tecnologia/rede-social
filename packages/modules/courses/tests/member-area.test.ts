import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  courseProgressOf,
  heroResume,
  type MemberCourseRow,
  type MemberLessonRow,
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
