import {
  COURSE_LEVELS,
  type CourseLevel,
  type LearnCourse,
  type LearnCourseCard,
  type LearnMyProgress,
  type LearnOverviewHero,
  type LearnOverviewTrack,
  type LearnShelfItem,
} from '@rede-social/module-courses/contracts';

/**
 * 2026-10-22 — what the member area's Início leads with, on the user's rule: the hero is ALWAYS the
 * continuation of what the member was watching, or, with nothing in progress, the platform's
 * suggestion: the next one at the member's level (or the initial course). A member who has not
 * started any lesson yet does not land on Início at all: they land on the catalogue
 * (`/area-membros/cursos`), and Início appears from their first lesson on (the user's choice).
 *
 * The API stays the authority on everything it decides (its `heroResume` picks the hero over every
 * lesson row; the web never sees a progress row): this module only REFINES its answer where the
 * user's rule differs, with data the member's own reads already carry (the catalogue cards: level,
 * `locked`, `completedCount`, `lessonCount`; the overview's track; a course page's outline; the
 * member's own progress read).
 *
 *  - `retomando` (a course in progress, at the lesson it stopped): kept as the API answered.
 *  - nothing started at all (`neverStarted`): the catalogue. Never in a preview (the admin writes no
 *    progress, so the preview would never show Início).
 *  - `comecando` (nothing in progress, something finished): the API takes the NEWEST published
 *    course; the suggestion here (`suggestedStart`) takes, among the open courses never touched, the
 *    next course of a track the member is on, else the first course of the member's level (and then
 *    the levels above it), published FIRST in that level, and draws it with the same card
 *    (`startHero`).
 *
 * Pure: no fetch, no clock, no storage; the Início body reads and decides with these.
 */

/** The ladder's rung of a level (iniciante 0, intermediário 1, avançado 2); a course with none is -1. */
function rungOf(level: CourseLevel | null): number {
  return level === null ? -1 : COURSE_LEVELS.indexOf(level);
}

/** A card the member can open and has never touched: its first open lesson is the next step. */
function isFreshOpen(card: LearnCourseCard): boolean {
  return !card.locked && card.lessonCount > 0 && card.completedCount === 0;
}

/** An open course whose every live lesson the member completed. */
function isDone(card: LearnCourseCard): boolean {
  return !card.locked && card.lessonCount > 0 && card.completedCount >= card.lessonCount;
}

/**
 * Request 2 (2026-10-22, "quem ainda não começou nada"): the member never started a lesson — the
 * server's progress read lists no started course (a progress row on any live lesson, the first
 * 15-second playback tick writes it) and no completed lesson. They land on the catalogue.
 */
export function neverStarted(progress: LearnMyProgress): boolean {
  return progress.courses.length === 0 && progress.lessonsDone === 0;
}

/**
 * Request 1 (2026-10-22): where a member with nothing in progress goes next (and, in a preview,
 * where a new member would start). Candidates are the open courses with a live lesson the member
 * never touched (in the API's `comecando` no open course is started and unfinished, so
 * `completedCount === 0` means untouched). In this order:
 *
 *  1. the member's own path: a track they started (`suggested: false`), at its next course;
 *  2. by level, when the school uses levels: the member's level is the highest level among the open
 *     courses they completed (none → iniciante); that level first, then the levels above it, then
 *     the ones below, then the courses with no level;
 *  3. inside a level (or across the school when it uses no level): the suggested track's next course
 *     when it is there (the school's curated way in), else the course published FIRST (the catalogue
 *     is newest first, so its last match): the school's initial course.
 *
 * `null` when no course qualifies (the API's own answer stands).
 */
export function suggestedStart(
  cards: readonly LearnCourseCard[],
  track: LearnOverviewTrack | null,
): LearnCourseCard | null {
  const candidates = cards.filter(isFreshOpen);
  if (candidates.length === 0) return null;

  if (track && !track.suggested) {
    const next = candidates.find((card) => card.id === track.resumeCourseId);
    if (next) return next;
  }

  const pick = (list: readonly LearnCourseCard[]): LearnCourseCard | null =>
    list.find((card) => card.id === track?.resumeCourseId) ?? list.at(-1) ?? null;

  if (!candidates.some((card) => card.level !== null)) return pick(candidates);

  const reached = cards.filter(isDone).map((card) => rungOf(card.level));
  const start = Math.max(0, ...reached);
  const rungs = COURSE_LEVELS.map((_, rung) => rung);
  const order = [...rungs.filter((rung) => rung >= start), ...rungs.filter((rung) => rung < start)];
  for (const rung of [...order, -1]) {
    const choice = pick(candidates.filter((card) => rungOf(card.level) === rung));
    if (choice) return choice;
  }
  return null;
}

/**
 * The hero of `course` at its next open lesson, in the `comecando` copy — the same fields the API's
 * `heroResume` fills (`moduleNumber` and `lessonNumber` are the outline's ranks among the live
 * modules and among the module's live lessons; `durationSeconds` sums the ready videos). `null` when
 * the course is locked for the member or has no open lesson left.
 */
export function startHero(course: LearnCourse): LearnOverviewHero | null {
  if (course.locked) return null;
  const lessonId = course.progress.nextLessonId;
  if (lessonId === null) return null;
  const module = course.modules.find((item) => item.lessons.some((row) => row.id === lessonId));
  const lesson = module?.lessons.find((row) => row.id === lessonId);
  if (!module || !lesson) return null;
  const durationSeconds = course.modules.reduce(
    (sum, item) => sum + item.lessons.reduce((total, row) => total + (row.durationSeconds ?? 0), 0),
    0,
  );
  return {
    state: 'comecando',
    courseId: course.id,
    courseTitle: course.title,
    courseTagline: course.tagline,
    coverAssetId: course.coverAssetId,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    lessonDurationSeconds: lesson.durationSeconds,
    moduleNumber: module.number,
    moduleTitle: module.title,
    lessonNumber: lesson.number,
    moduleLessonsLeft: module.lessons.filter((row) => row.completedAt === null).length,
    isFree: lesson.isFree,
    percent: course.progress.percent,
    done: course.progress.done,
    total: course.progress.total,
    lessonCount: course.progress.total,
    durationSeconds,
  };
}

/** The shelf's size (the API's `SHELF_SIZE`): at most three rows. */
const SHELF_SIZE = 3;

/**
 * "Meus cursos" after the hero changed course: the API built the shelf WITHOUT its own hero, so the
 * new hero's row leaves it and the displaced course comes back where the API's cascade would have
 * put it — as the track's next course right after the courses in progress, else first among the
 * unstarted ones (it is the newest open course nobody started). Three rows at most; `undefined`
 * when nothing is left (the section is absent, never empty).
 */
export function swapShelf(
  shelf: readonly LearnShelfItem[] | undefined,
  heroCourseId: string,
  displaced: LearnOverviewHero,
  track: LearnOverviewTrack | null,
): LearnShelfItem[] | undefined {
  const rows = (shelf ?? []).filter(
    (row) => row.courseId !== heroCourseId && row.courseId !== displaced.courseId,
  );
  const kind = track?.resumeCourseId === displaced.courseId ? 'proximo_da_trilha' : 'nao_iniciado';
  const back: LearnShelfItem = {
    courseId: displaced.courseId,
    title: displaced.courseTitle,
    coverAssetId: displaced.coverAssetId,
    kind,
    percent: displaced.percent,
    done: displaced.done,
    total: displaced.total,
    lessonCount: displaced.lessonCount,
    durationSeconds: displaced.durationSeconds,
  };
  let at =
    kind === 'proximo_da_trilha'
      ? rows.findIndex((row) => row.kind !== 'em_andamento')
      : rows.findIndex((row) => row.kind !== 'em_andamento' && row.kind !== 'proximo_da_trilha');
  if (at === -1) at = rows.length;
  rows.splice(at, 0, back);
  const out = rows.slice(0, SHELF_SIZE);
  return out.length > 0 ? out : undefined;
}
