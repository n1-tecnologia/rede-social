import type { LessonLockReason } from './index';

/**
 * The member area's pure helpers (08.6, D-437, COURSE-29; RESEARCH Pattern 2). Ported from the
 * design prototype's `heroResume` / `continueWatching` / `courseProgress`, with the server as the
 * authority: the API calls these over the rows of `app.course_member_lessons()` (one row per live
 * lesson of every PUBLISHED course, with the database evaluator's `lock_reason` and the caller's
 * own progress) and the published course rows it reads with `locked` from the kernel seam, and
 * answers finished views. The web renders those views and never re-derives them.
 *
 * Pure by construction: no database import, no clock, no storage. Every lock comes IN (the row's
 * `lockReason`, the course's `locked`); nothing here compares an entitlement or a rule (D-428).
 *
 * Mapping from the prototype's state to real data (RESEARCH Pattern 2):
 *
 * | prototype                         | here                                                        |
 * |-----------------------------------|-------------------------------------------------------------|
 * | `p.completed`                     | rows with `completedAt !== null`                            |
 * | `p.lastLessonByCourse`/`startedAt`| per course, the row with the greatest `touchedAt`           |
 * |                                   | (`course_lesson_progress.updated_at`)                       |
 * | `resolveLock(course)`             | `MemberCourseRow.locked` (the kernel seam)                  |
 * | `resolveLock(lesson)`             | `MemberLessonRow.lockReason` (the evaluator)                |
 * | `courseProgress.nextLesson`       | first row in `courseSeq` order, not completed, not locked   |
 * | `mockCourses` order               | the order of the `courses` argument: the catalogue order    |
 * |                                   | (`published_at desc, id desc`), which the service reads     |
 * | `p.premium`, `featured`           | none (the store entitlement is already inside `locked`)     |
 *
 * Two predicates every helper of the phase shares (08.6-01 planning decision 3):
 *  - a course is STARTED when the caller holds any progress row on one of its live lessons (a
 *    non-null `touchedAt`; the first 15-second playback tick writes it);
 *  - a course is COMPLETE when it has at least one live lesson and every live lesson is complete.
 *
 * Instants are the service's fixed-width microsecond ISO strings (`…T12:00:00.000000Z`), so their
 * lexical order is their chronological order to the microsecond.
 */

/** One row of `app.course_member_lessons()`, camelCased; instants as ISO strings. */
export interface MemberLessonRow {
  courseId: string;
  moduleId: string;
  lessonId: string;
  /** The lesson's 1-based rank in course order (the evaluator's `course_seq`). */
  courseSeq: number;
  /** The module's 1-based rank among the course's non-empty live modules (`module_seq`). */
  moduleSeq: number;
  lessonTitle: string;
  moduleTitle: string;
  isFree: boolean;
  /** The ready video's seconds, null without a ready video. */
  durationSeconds: number | null;
  /** The evaluator's answer for the caller; null is open. */
  lockReason: LessonLockReason | null;
  /** The caller's own completion instant (one-way, D-427). */
  completedAt: string | null;
  /** The caller's own progress row's `updated_at`; null when the caller never touched it. */
  touchedAt: string | null;
  lessonCreatedAt: string;
}

/** A published course as the service reads it, in catalogue order. */
export interface MemberCourseRow {
  id: string;
  title: string;
  tagline: string;
  coverAssetId: string | null;
  publishedAt: string;
  /** Product-gated for the caller (the kernel seam; false for staff and with the store off). */
  locked: boolean;
}

/** D-430: a course's progress over its live lessons. */
export interface MemberCourseProgress {
  done: number;
  total: number;
  /** `floor(done * 100 / total)`, 0 when `total` is 0. */
  percent: number;
  /** The first lesson in course order neither completed nor locked; null when none. */
  nextLessonId: string | null;
}

/** D-437: the hero's three states; one card, only the copy changes. */
export type HeroState = 'retomando' | 'comecando' | 'em_dia';

/**
 * The hero view (UI-SPEC "Contract requirements this document places on the API"). The lesson
 * fields are null when the hero names a course without a lesson ("Conhecer o curso").
 */
export interface MemberHero {
  state: HeroState;
  courseId: string;
  courseTitle: string;
  courseTagline: string;
  coverAssetId: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  lessonDurationSeconds: number | null;
  /** The evaluator's `module_seq` of the lesson's module. */
  moduleNumber: number | null;
  moduleTitle: string | null;
  /** The lesson's 1-based rank among the live lessons of its module. */
  lessonNumber: number | null;
  /** The incomplete live lessons of the lesson's module (0 without a lesson). */
  moduleLessonsLeft: number;
  isFree: boolean;
  percent: number;
  done: number;
  total: number;
  /** The course's live lessons (the card's "{N} aulas"). */
  lessonCount: number;
  /** The sum of the course's ready-video seconds. */
  durationSeconds: number;
}

const bySeq = (a: MemberLessonRow, b: MemberLessonRow) => a.courseSeq - b.courseSeq;

/** Chronological order of two fixed-width ISO instants; null sorts first. */
function compareInstant(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** D-430: done / total / floor percent / next open incomplete lesson, in course order. */
export function courseProgressOf(rows: readonly MemberLessonRow[]): MemberCourseProgress {
  const ordered = [...rows].sort(bySeq);
  const total = ordered.length;
  const done = ordered.filter((row) => row.completedAt !== null).length;
  const next = ordered.find((row) => row.completedAt === null && row.lockReason === null);
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.floor((done * 100) / total),
    nextLessonId: next?.lessonId ?? null,
  };
}

/** The live lessons of every course, each list in course order. */
function groupByCourse(lessons: readonly MemberLessonRow[]): Map<string, MemberLessonRow[]> {
  const byCourse = new Map<string, MemberLessonRow[]>();
  for (const row of lessons) {
    const list = byCourse.get(row.courseId);
    if (list) list.push(row);
    else byCourse.set(row.courseId, [row]);
  }
  for (const list of byCourse.values()) list.sort(bySeq);
  return byCourse;
}

/** The course's most recently touched row (ties: the later lesson in course order); null if none. */
function lastTouched(rows: readonly MemberLessonRow[]): MemberLessonRow | null {
  let last: MemberLessonRow | null = null;
  for (const row of rows) {
    if (row.touchedAt === null) continue;
    if (last === null || compareInstant(row.touchedAt, last.touchedAt) >= 0) last = row;
  }
  return last;
}

const isComplete = (rows: readonly MemberLessonRow[]) =>
  rows.length > 0 && rows.every((row) => row.completedAt !== null);

/** Builds the hero view of `course` at `lesson` (or at no lesson). */
function heroView(
  state: HeroState,
  course: MemberCourseRow,
  rows: readonly MemberLessonRow[],
  lesson: MemberLessonRow | null,
): MemberHero {
  const progress = courseProgressOf(rows);
  const durationSeconds = rows.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0);
  const moduleRows = lesson ? rows.filter((row) => row.moduleId === lesson.moduleId) : [];
  return {
    state,
    courseId: course.id,
    courseTitle: course.title,
    courseTagline: course.tagline,
    coverAssetId: course.coverAssetId,
    lessonId: lesson?.lessonId ?? null,
    lessonTitle: lesson?.lessonTitle ?? null,
    lessonDurationSeconds: lesson?.durationSeconds ?? null,
    moduleNumber: lesson?.moduleSeq ?? null,
    moduleTitle: lesson?.moduleTitle ?? null,
    lessonNumber: lesson
      ? moduleRows.findIndex((row) => row.lessonId === lesson.lessonId) + 1
      : null,
    moduleLessonsLeft: moduleRows.filter((row) => row.completedAt === null).length,
    isFree: lesson?.isFree ?? false,
    percent: progress.percent,
    done: progress.done,
    total: progress.total,
    lessonCount: progress.total,
    durationSeconds,
  };
}

/**
 * D-437: the hero is always a course to watch, decided over the published courses in catalogue
 * order and the rows of `app.course_member_lessons()`:
 *
 *  1. `retomando` — among the UNLOCKED, STARTED, incomplete courses, the one holding the caller's
 *     most recently touched progress row (ties: the smaller course id); it resumes that row's
 *     lesson when the lesson is incomplete and open, else the course's first incomplete open
 *     lesson in course order;
 *  2. `comecando` — the first unlocked course (catalogue order) with no progress row and an open
 *     live lesson, at its first open lesson;
 *  3. `em_dia` — the first incomplete free lesson of a locked course (`isFree: true`); else the
 *     first locked course, `lessonId: null`; else (nothing locked, everything complete: 08.6-01
 *     planning decision 4) the most recently touched course, `lessonId: null`.
 *
 * A course in the caller's locked set is never `retomando` or `comecando` (R-A3), and a course
 * with zero live lessons is never a hero. No published course with a live lesson → null.
 */
export function heroResume(
  courses: readonly MemberCourseRow[],
  lessons: readonly MemberLessonRow[],
): MemberHero | null {
  const byCourse = groupByCourse(lessons);
  const withLessons = courses.filter((course) => (byCourse.get(course.id)?.length ?? 0) > 0);
  if (withLessons.length === 0) return null;
  const rowsOf = (course: MemberCourseRow) => byCourse.get(course.id) ?? [];
  const isOpen = (row: MemberLessonRow) => row.lockReason === null;

  // 1. retomando
  let resume: { course: MemberCourseRow; touched: MemberLessonRow } | null = null;
  for (const course of withLessons) {
    if (course.locked) continue;
    const rows = rowsOf(course);
    const touched = lastTouched(rows);
    if (touched === null || isComplete(rows)) continue;
    if (resume === null) {
      resume = { course, touched };
      continue;
    }
    const order = compareInstant(touched.touchedAt, resume.touched.touchedAt);
    if (order > 0 || (order === 0 && course.id < resume.course.id)) resume = { course, touched };
  }
  if (resume) {
    const rows = rowsOf(resume.course);
    const { touched } = resume;
    const lesson =
      touched.completedAt === null && isOpen(touched)
        ? touched
        : (rows.find((row) => row.completedAt === null && isOpen(row)) ?? null);
    return heroView('retomando', resume.course, rows, lesson);
  }

  // 2. comecando
  for (const course of withLessons) {
    if (course.locked) continue;
    const rows = rowsOf(course);
    if (lastTouched(rows) !== null) continue;
    const first = rows.find(isOpen);
    if (first) return heroView('comecando', course, rows, first);
  }

  // 3. em_dia
  const locked = withLessons.filter((course) => course.locked);
  for (const course of locked) {
    const rows = rowsOf(course);
    const free = rows.find((row) => row.isFree && row.completedAt === null && isOpen(row));
    if (free) return heroView('em_dia', course, rows, free);
  }
  const firstLocked = locked[0];
  if (firstLocked) return heroView('em_dia', firstLocked, rowsOf(firstLocked), null);

  let recent: { course: MemberCourseRow; touched: MemberLessonRow | null } | null = null;
  for (const course of withLessons) {
    const touched = lastTouched(rowsOf(course));
    if (recent === null) {
      recent = { course, touched };
      continue;
    }
    const order = compareInstant(touched?.touchedAt ?? null, recent.touched?.touchedAt ?? null);
    if (order > 0 || (order === 0 && touched !== null && course.id < recent.course.id)) {
      recent = { course, touched };
    }
  }
  return recent ? heroView('em_dia', recent.course, rowsOf(recent.course), null) : null;
}
