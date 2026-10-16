import type { LessonLockReason } from './index';

/**
 * RED STUB (08.6-01, TDD): the member-area helpers' shapes with inert bodies, so
 * `tests/member-area.test.ts` fails on its assertions rather than on an import. The GREEN commit
 * replaces both bodies with the D-437 cascade.
 */

export interface MemberLessonRow {
  courseId: string;
  moduleId: string;
  lessonId: string;
  courseSeq: number;
  moduleSeq: number;
  lessonTitle: string;
  moduleTitle: string;
  isFree: boolean;
  durationSeconds: number | null;
  lockReason: LessonLockReason | null;
  completedAt: string | null;
  touchedAt: string | null;
  lessonCreatedAt: string;
}

export interface MemberCourseRow {
  id: string;
  title: string;
  tagline: string;
  coverAssetId: string | null;
  publishedAt: string;
  locked: boolean;
}

export interface MemberCourseProgress {
  done: number;
  total: number;
  percent: number;
  nextLessonId: string | null;
}

export type HeroState = 'retomando' | 'comecando' | 'em_dia';

export interface MemberHero {
  state: HeroState;
  courseId: string;
  courseTitle: string;
  courseTagline: string;
  coverAssetId: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  lessonDurationSeconds: number | null;
  moduleNumber: number | null;
  moduleTitle: string | null;
  lessonNumber: number | null;
  moduleLessonsLeft: number;
  isFree: boolean;
  percent: number;
  done: number;
  total: number;
  lessonCount: number;
  durationSeconds: number;
}

export function courseProgressOf(_rows: readonly MemberLessonRow[]): MemberCourseProgress {
  return { done: 0, total: 0, percent: 0, nextLessonId: null };
}

export function heroResume(
  _courses: readonly MemberCourseRow[],
  _lessons: readonly MemberLessonRow[],
): MemberHero | null {
  return null;
}
