import type { LearnHeroState, LessonLockReason, ShelfKind } from './index';

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
export type HeroState = LearnHeroState;

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

/**
 * 08.6-01 planning decision 3: a course is STARTED when the caller holds any progress row on one of
 * its live lessons (a non-null `touchedAt`).
 */
export const isStarted = (rows: readonly MemberLessonRow[]): boolean =>
  rows.some((row) => row.touchedAt !== null);

/**
 * 08.6-01 planning decision 3: a course is COMPLETE when it has at least one live lesson and every
 * live lesson is complete (a course with zero live lessons is never complete).
 */
export const isComplete = (rows: readonly MemberLessonRow[]): boolean =>
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

// ── "Meus cursos" and "Sua trilha" (08.6-03, D-436, D-438, COURSE-30, COURSE-31) ─────────────────

/**
 * An ACTIVE track as the service reads it, in the admin order (`created_at desc, id desc`), with
 * `courseIds` in path order (`position asc, course_id asc`). The helpers keep only the ids present
 * in the published-course list they are given (D-415: an unpublished course drops out at read time).
 */
export interface MemberTrackRow {
  id: string;
  title: string;
  coverAssetId: string | null;
  courseIds: readonly string[];
}

/** One "Meus cursos" row (UI-SPEC "Contract requirements": the shelf fields). */
export interface ShelfItem {
  courseId: string;
  title: string;
  coverAssetId: string | null;
  kind: ShelfKind;
  percent: number;
  done: number;
  /** The course's live lessons (the progress denominator). */
  total: number;
  /** The course's live lessons (the row's "{N} aulas"). */
  lessonCount: number;
  /** The sum of the course's ready-video seconds. */
  durationSeconds: number;
}

/** "Sua trilha" (UI-SPEC "Contract requirements": the track fields). */
export interface OverviewTrack {
  id: string;
  title: string;
  coverAssetId: string | null;
  /** No track was started: this one is recommended, not "yours" (D-438). */
  suggested: boolean;
  /** `floor(done * 100 / total)` over the live lessons of the path's courses (lesson-weighted). */
  percent: number;
  /** The courses in the path. */
  total: number;
  coursesDone: number;
  /** 1-based index of the first incomplete course; `total` when every course is complete. */
  currentIndex: number;
  currentCourseTitle: string;
  /** The first incomplete course; the first course when every course is complete. */
  resumeCourseId: string;
  /** The last locked, incomplete course of the path (the shop-window hook), or null. */
  lastLockedCourseTitle: string | null;
}

/** The course's last touched instant (the greatest `touchedAt` of its rows); null when untouched. */
const lastTouchedAt = (rows: readonly MemberLessonRow[]): string | null =>
  lastTouched(rows)?.touchedAt ?? null;

/** Builds one shelf row of `course` over its live lessons. */
function shelfItem(
  kind: ShelfKind,
  course: MemberCourseRow,
  rows: readonly MemberLessonRow[],
): ShelfItem {
  const progress = courseProgressOf(rows);
  return {
    courseId: course.id,
    title: course.title,
    coverAssetId: course.coverAssetId,
    kind,
    percent: progress.percent,
    done: progress.done,
    total: progress.total,
    lessonCount: progress.total,
    durationSeconds: rows.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0),
  };
}

/** "Last touched desc, then course id asc" (the em_andamento and concluido order, EP-07). */
function byLastTouchDesc(
  a: { course: MemberCourseRow; at: string | null },
  b: { course: MemberCourseRow; at: string | null },
): number {
  const order = compareInstant(b.at, a.at);
  if (order !== 0) return order;
  return a.course.id < b.course.id ? -1 : a.course.id > b.course.id ? 1 : 0;
}

/** The shelf's size (UI-D-450): at most three rows, never padded. */
const SHELF_SIZE = 3;

/**
 * D-436 (COURSE-30): "Meus cursos" — ports the prototype's `courseShelf` (`members-progress.ts`)
 * over the published courses in catalogue order, the member projection's rows and the ACTIVE track
 * (`activeTrack`'s choice, as its path of course ids). At most three rows, NEVER the hero's course,
 * each course once, filled in this cascade (the shop window: a finished member meets the padlocks,
 * a member who is starting meets the path):
 *
 *  1. `em_andamento` — UNLOCKED, STARTED, incomplete courses, last touched desc then id asc;
 *  2. `proximo_da_trilha` — the active track's next course: its first course (path order) that is
 *     unlocked, unstarted and has a live lesson; at most one. Like the prototype, the next course is
 *     decided BEFORE the hero exclusion, so when the hero already is the track's next course no row
 *     of this kind appears (the hero card shows it);
 *  3. `nao_iniciado` — the other unlocked, unstarted courses with a live lesson, catalogue order;
 *  4. `bloqueado` — the LOCKED courses that are not complete, catalogue order (R-A3: a revoked
 *     course with progress lands here, never in `em_andamento`);
 *  5. `concluido` — the complete courses, last touched desc then id asc.
 *
 * Deltas from the prototype: no `size` option (always three, the section is absent when empty
 * instead of padded, UI-D-450), no `premium` (the store entitlement is already inside `locked`),
 * "started" is a progress row and not a completion (08.6-01 planning decision 3), and an unlocked
 * course with zero live lessons never appears.
 */
export function courseShelf(
  courses: readonly MemberCourseRow[],
  lessons: readonly MemberLessonRow[],
  track: Pick<MemberTrackRow, 'courseIds'> | null,
  heroCourseId: string | null,
): ShelfItem[] {
  const byCourse = groupByCourse(lessons);
  const rowsOf = (course: MemberCourseRow) => byCourse.get(course.id) ?? [];
  const out: ShelfItem[] = [];
  const used = new Set<string>(heroCourseId ? [heroCourseId] : []);
  const push = (kind: ShelfKind, course: MemberCourseRow) => {
    if (used.has(course.id) || out.length >= SHELF_SIZE) return;
    used.add(course.id);
    out.push(shelfItem(kind, course, rowsOf(course)));
  };
  const isFresh = (course: MemberCourseRow) =>
    !course.locked && rowsOf(course).length > 0 && !isStarted(rowsOf(course));

  // 1. em_andamento
  const inProgress = courses
    .filter((course) => !course.locked && isStarted(rowsOf(course)) && !isComplete(rowsOf(course)))
    .map((course) => ({ course, at: lastTouchedAt(rowsOf(course)) }))
    .sort(byLastTouchDesc);
  for (const { course } of inProgress) push('em_andamento', course);

  // 2. proximo_da_trilha
  if (track) {
    const byId = new Map(courses.map((course) => [course.id, course]));
    const next = track.courseIds
      .map((id) => byId.get(id))
      .find((course): course is MemberCourseRow => course !== undefined && isFresh(course));
    if (next) push('proximo_da_trilha', next);
  }

  // 3. nao_iniciado
  for (const course of courses) if (isFresh(course)) push('nao_iniciado', course);

  // 4. bloqueado
  for (const course of courses) {
    if (course.locked && !isComplete(rowsOf(course))) push('bloqueado', course);
  }

  // 5. concluido
  const completed = courses
    .filter((course) => isComplete(rowsOf(course)))
    .map((course) => ({ course, at: lastTouchedAt(rowsOf(course)) }))
    .sort(byLastTouchDesc);
  for (const { course } of completed) push('concluido', course);

  return out;
}

/**
 * D-438 (COURSE-31): the member's track — ports the prototype's `activeTrack` / `trackProgress` /
 * `resumeCourseId` over the ACTIVE tracks in admin order (`created_at desc, id desc`, A14), each
 * path filtered to the published courses given (D-415):
 *
 *  - among the STARTED tracks (at least one completed live lesson in the path), the one with the
 *    highest `floor(doneLessons * 100 / totalLessons)` — lesson-weighted, as the prototype's
 *    `trackProgress` ("a 20-lesson course must not weigh like a 6-lesson one"); equal percents keep
 *    the earlier track in admin order (EP-08); a course in two tracks counts in both;
 *  - with none started, the first track holding a published course, `suggested: true`;
 *  - else null (no track, or every track's courses are draft or archived, EP-09).
 *
 * The view (EP-10): `total` = the path's courses, `coursesDone` = complete courses, `currentIndex`
 * = the 1-based index of the first incomplete course (`total` when all are complete) with its title
 * as `currentCourseTitle`, `resumeCourseId` = that course (the first course when all are complete),
 * `lastLockedCourseTitle` = the last locked, incomplete course of the path or null.
 *
 * Deltas from the prototype: it never answers null (it always paints a card) — here the section is
 * absent with no track; there is no admin "featured" pre-pass and no member choice; the prototype's
 * `currentIndex` (the first STARTED incomplete course) is replaced by the first incomplete course.
 */
export function activeTrack(
  tracks: readonly MemberTrackRow[],
  courses: readonly MemberCourseRow[],
  lessons: readonly MemberLessonRow[],
): OverviewTrack | null {
  const byCourse = groupByCourse(lessons);
  const byId = new Map(courses.map((course) => [course.id, course]));
  const rowsOf = (course: MemberCourseRow) => byCourse.get(course.id) ?? [];

  type Candidate = { track: MemberTrackRow; path: MemberCourseRow[]; percent: number };
  let best: Candidate | null = null;
  let first: Candidate | null = null;
  for (const track of tracks) {
    const path = track.courseIds
      .map((id) => byId.get(id))
      .filter((course): course is MemberCourseRow => course !== undefined);
    if (path.length === 0) continue;
    let done = 0;
    let total = 0;
    for (const course of path) {
      const progress = courseProgressOf(rowsOf(course));
      done += progress.done;
      total += progress.total;
    }
    const candidate = {
      track,
      path,
      percent: total === 0 ? 0 : Math.floor((done * 100) / total),
    };
    first ??= candidate;
    if (done > 0 && (best === null || candidate.percent > best.percent)) best = candidate;
  }

  const chosen = best ?? first;
  if (chosen === null) return null;
  const { track, path, percent } = chosen;
  const completeAt = path.map((course) => isComplete(rowsOf(course)));
  const firstOpen = completeAt.indexOf(false);
  const currentIndex = firstOpen === -1 ? path.length : firstOpen + 1;
  const resume = firstOpen === -1 ? path[0] : path[firstOpen];
  const current = path[currentIndex - 1];
  const lastLocked = [...path]
    .reverse()
    .find((course) => course.locked && !isComplete(rowsOf(course)));
  return {
    id: track.id,
    title: track.title,
    coverAssetId: track.coverAssetId,
    suggested: best === null,
    percent,
    total: path.length,
    coursesDone: completeAt.filter(Boolean).length,
    currentIndex,
    currentCourseTitle: current?.title ?? '',
    resumeCourseId: resume?.id ?? '',
    lastLockedCourseTitle: lastLocked?.title ?? null,
  };
}

// ── "Próxima live" and "Novas aulas da semana" (08.6-03, D-444, D-446, COURSE-32, COURSE-33) ────

/**
 * One row of `app.course_live_cards()` as the overview reads it, camelCased; instants as ISO
 * strings. The projection never returns the room link or the replay lesson id (08.5 PR-1), so
 * neither can reach a helper or an answer.
 */
export interface MemberLiveCardRow {
  id: string;
  title: string;
  coverAssetId: string | null;
  startsAt: string;
  durationMin: number;
  cancelledAt: string | null;
  /** The live seam's answer for the caller (`app.live_locked_ids()`). */
  locked: boolean;
}

/** The overview's live (UI-SPEC "Contract requirements": the live fields; no link, no replay). */
export interface OverviewLive {
  id: string;
  title: string;
  coverAssetId: string | null;
  startsAt: string;
  durationMin: number;
  status: 'live' | 'scheduled';
  locked: boolean;
  /** The caller's own `course_live_reminders` row exists for this live. */
  reminderOn: boolean;
}

/** One "Novas aulas da semana" item (UI-SPEC "Contract requirements": the new-lesson fields). */
export interface NewLessonItem {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  /** The ready video's seconds; null without a ready video. */
  durationSeconds: number | null;
  /** The course's cover (the item's thumbnail). */
  coverAssetId: string | null;
  done: boolean;
}

/** RED stub (08.6-03 Task 2): inert until the GREEN commit; answers no live. */
export function nextLiveOf(
  _cards: readonly MemberLiveCardRow[],
  _now: Date,
  _reminderLiveIds: ReadonlySet<string>,
): OverviewLive | null {
  return null;
}

/** RED stub (08.6-03 Task 2): inert until the GREEN commit; answers no lesson. */
export function newLessonsOf(
  _courses: readonly MemberCourseRow[],
  _lessons: readonly MemberLessonRow[],
  _now: Date,
): NewLessonItem[] {
  return [];
}
