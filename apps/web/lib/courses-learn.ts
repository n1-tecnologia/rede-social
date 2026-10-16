import {
  COURSE_PAGE_SIZE,
  type LearnCataloguePage,
  type LearnCourse,
  type LearnLesson,
  type LearnLive,
  type LearnLivesPage,
  type LearnMyProgress,
  type LearnOverview,
  type LearnTracks,
  learnCataloguePageSchema,
  learnCourseSchema,
  learnLessonSchema,
  learnLiveSchema,
  learnLivesPageSchema,
  learnMyProgressSchema,
  learnOverviewSchema,
  learnReminderSchema,
  learnTracksSchema,
  type MaterialUrl,
  materialUrlSchema,
  type ProgressBody,
  type ProgressResult,
  progressResultSchema,
} from '@rede-social/module-courses/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED } from '@/lib/courses';

/**
 * The member side's courses fetchers (08.5-06, D-419, D-420, COURSE-17): the `/v1/courses/learn/*`
 * reads every role of a tenant with `courses` on may call. `lib/courses.ts` stays the manager's
 * (planning decision 2), so a member surface never imports an admin fetcher by accident.
 *
 * Each read answers a result union and NEVER throws: `ok` with the parsed page (the contract's
 * strict schema, so a drifted API shape fails here, not in a component), `disabled` when the module
 * was switched off between the bootstrap and the read (`404 MODULE_DISABLED` → the kernel
 * not-found), `redirect` for a refusal the bootstrap knows (401, blocked, suspended…; the CALLER
 * navigates, because `redirect()` throws), and `error` for anything else (the first-load error card
 * with its retry).
 *
 * **The web never sorts** (P09): pages render in the API's order. **The cursor is opaque**:
 * forwarded exactly as the previous page returned it. Logs carry `{ status, code }` only — a course
 * title is tenant content.
 */

/** Reads the envelope's error code (and details) without ever throwing on a non-JSON body. */
async function readError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    if (body?.error?.details && typeof body.error.details === 'object') {
      details = body.error.details;
    }
  } catch {
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

export type LearnReadResult<T> =
  | { status: 'ok'; page: T }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** The shared mapping of one learn read's answer; `op` names the log line, never a title. */
async function learnRead<T>(
  path: string,
  parse: (body: unknown) => T,
  op: string,
): Promise<LearnReadResult<T>> {
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: 'ok', page: parse(await res.json()) };
    const error = await readError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    console.error(op, { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error(op, { error: String(error) });
    return { status: 'error' };
  }
}

export interface LearnCatalogueInput {
  /** A category id the caller already whitelisted; omitted for "Todas". */
  categoryId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * `GET /v1/courses/learn/courses?categoryId=&cursor=&limit=` (08.5-04, COURSE-17): the member
 * catalogue — published courses newest first, locked and open in one list, the caller's own
 * `completedCount`, and the category chips (only categories holding a published course, whatever
 * the filter).
 */
export async function getLearnCatalogue(
  input: LearnCatalogueInput = {},
): Promise<LearnReadResult<LearnCataloguePage>> {
  const search = new URLSearchParams();
  if (input.categoryId) search.set('categoryId', input.categoryId);
  if (input.cursor) search.set('cursor', input.cursor);
  search.set('limit', String(input.limit ?? COURSE_PAGE_SIZE));
  return learnRead(
    `/v1/courses/learn/courses?${search.toString()}`,
    (body) => learnCataloguePageSchema.parse(body),
    'courses.learn_catalogue_failed',
  );
}

/**
 * `GET /v1/courses/learn/lives?cursor=` (08.5-04, D-431, COURSE-23): the member agenda. Page 1 holds
 * the WHOLE "Próximas" group (live now, scheduled, cancelled until its planned end; nearest first)
 * and the first 20 "Gravadas" (recorded with a replay; newest first); later pages carry
 * `upcoming: []` and page only the recordings. Every status is the API clock's, never the browser's
 * (UI-D-288). No card ever carries the room link or the replay lesson id.
 */
export async function getLearnLives(
  input: { cursor?: string } = {},
): Promise<LearnReadResult<LearnLivesPage>> {
  const search = new URLSearchParams();
  if (input.cursor) search.set('cursor', input.cursor);
  const query = search.toString();
  return learnRead(
    query ? `/v1/courses/learn/lives?${query}` : '/v1/courses/learn/lives',
    (body) => learnLivesPageSchema.parse(body),
    'courses.learn_lives_failed',
  );
}

/**
 * `GET /v1/courses/learn/overview` (08.6-01, 08.6-03, D-435..D-438, D-440, COURSE-28..34, COURSE-37):
 * the school home ("Início") as the SERVER decided it for the caller — `streakDays` (the tenant's
 * local days, never the browser's clock), the `hero` (absent in an empty school) and every other
 * section only when it has data (an absent key, never `[]`). Parsed with the strict
 * `learnOverviewSchema`, so a drifted shape is an `error` here and never a half-rendered page. The
 * web renders this answer and decides nothing: no lock, no hero state, no shelf kind, no track, no
 * count (UI-SPEC E02..E09, T-08.6-17).
 */
export async function getLearnOverview(): Promise<LearnReadResult<LearnOverview>> {
  return learnRead(
    '/v1/courses/learn/overview',
    (body) => learnOverviewSchema.parse(body),
    'courses.learn_overview_failed',
  );
}

/**
 * `GET /v1/courses/learn/tracks` (08.6-04, D-439, D-438, COURSE-35): the tenant's active tracks in
 * the admin order, each with its published courses in path order and every course's state as the
 * SERVER decided it (`concluida`, `em_andamento`, `a_seguir`, `bloqueada`), the caller's
 * lesson-weighted percent and the `mine` / `suggested` marks of the overview's own track. An empty
 * answer is `{ tracks: [] }` (the Trilhas tab draws its own empty state). Strict-parsed with
 * `learnTracksSchema`; the web decides no state and counts nothing (T-08.6-17).
 */
export async function getLearnTracks(): Promise<LearnReadResult<LearnTracks>> {
  return learnRead(
    '/v1/courses/learn/tracks',
    (body) => learnTracksSchema.parse(body),
    'courses.learn_tracks_failed',
  );
}

/**
 * `GET /v1/courses/learn/progress` (08.6-04, D-440..D-443, COURSE-36..38): the caller's own numbers
 * as the SERVER counted them — the streak, lessons done of the school total, the ring `percent`, the
 * completed lessons' ready seconds, the courses completed, and the started courses (last activity
 * first). Strict-parsed with `learnMyProgressSchema`; the web only formats (`formatWatched`,
 * plurals) and never counts days, lessons or seconds (E02, E11, T-08.6-17).
 */
export async function getLearnProgress(): Promise<LearnReadResult<LearnMyProgress>> {
  return learnRead(
    '/v1/courses/learn/progress',
    (body) => learnMyProgressSchema.parse(body),
    'courses.learn_progress_failed',
  );
}

export type LearnCourseResult =
  | { status: 'ok'; course: LearnCourse }
  | { status: 'not_found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/learn/courses/{courseId}` (08.5-01, D-423, D-426, D-430, COURSE-18): a PUBLISHED
 * course as the member course page reads it — the header, `locked`, the TITLES-ONLY curriculum with
 * each lesson's `lockReason` and the caller's own progress, and the progress summary. A locked
 * lesson arrives without description, video, poster or material (PR-1), so nothing this page renders
 * can carry them into the RSC payload (T-08.5-13).
 *
 * One bare 404 for an unknown, foreign, draft or archived course — for EVERY role, buyers and a
 * previewing admin included (D-426) → `not_found` (the segment's "Curso indisponível"). The id is
 * not pre-validated here: the API's 400 for a non-uuid maps to `not_found` too, so a crafted path
 * reads exactly like a missing course and never as an error card.
 */
export async function getLearnCourse(courseId: string): Promise<LearnCourseResult> {
  try {
    const res = await apiFetch(`/v1/courses/learn/courses/${encodeURIComponent(courseId)}`);
    if (res.ok) return { status: 'ok', course: learnCourseSchema.parse(await res.json()) };
    const error = await readError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    console.error('courses.learn_course_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.learn_course_failed', { error: String(error) });
    return { status: 'error' };
  }
}

export type LearnLiveResult =
  | { status: 'ok'; live: LearnLive }
  | { status: 'not_found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/learn/lives/{liveId}` (08.5-04, 08.5-09, D-432..D-434, COURSE-24): one live as
 * the member's live page reads it — the card, the description, and the ONE state the server decided
 * (`cancelled`, `locked`, `open`, `before`, `replay`, `ended`) on ITS clock. `joinUrl` is the room
 * link only in the `open` state (null otherwise, and always for a locked live — PR-1), `serverNow`
 * and the window edges drive the page's refresh timer, `startsToday` was decided in the tenant's
 * timezone, and `replay` is set only in the `replay` state (read through the live door, D-433).
 *
 * A cancelled live keeps its page (D-431). One bare 404 for an unknown or foreign live, and the
 * API's 400 for a crafted (non-uuid) id → `not_found` too, so the segment's "Live indisponível" is
 * never an existence oracle. Never throws; logs `{ status, code }` only (a title is tenant content,
 * and the link must never reach a log).
 */
export async function getLearnLive(liveId: string): Promise<LearnLiveResult> {
  try {
    const res = await apiFetch(`/v1/courses/learn/lives/${encodeURIComponent(liveId)}`);
    if (res.ok) return { status: 'ok', live: learnLiveSchema.parse(await res.json()) };
    const error = await readError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    console.error('courses.learn_live_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.learn_live_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/* ── 08.6-11: the live reminder (D-444, D-446, D-422, COURSE-40, UI-D-453, R-A12) ────────────── */

const reminderPath = (liveId: string) =>
  `/v1/courses/learn/lives/${encodeURIComponent(liveId)}/reminder`;

export type LiveReminderRead =
  | { status: 'ok'; on: boolean }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/learn/lives/{liveId}/reminder` (08.6-05, R-A12): whether the CALLER's own reminder
 * for this live is on — the live page's toggle starts from it, so the 08.5 `learnLiveSchema` answer
 * stays byte-compatible. An `admin_tenant` always reads `{ on: false }` (the preview never writes).
 * Any failure (a 404 for a live gone since the page read, the module switched off, a transport
 * error) is `error`: the page then draws the toggle off, which a tap can only correct (the write is
 * idempotent). Never throws; logs `{ status, code }` only.
 */
export async function getLiveReminder(liveId: string): Promise<LiveReminderRead> {
  try {
    const res = await apiFetch(reminderPath(liveId));
    if (res.ok) return { status: 'ok', on: learnReminderSchema.parse(await res.json()).on };
    const error = await readError(res);
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    console.error('courses.live_reminder_read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.live_reminder_read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A reminder write's answer (UI-D-453): `ok` with the server's `{ on }` (the API's 204 for an
 * `admin_tenant` maps to the requested value, never shown — the preview never sends), `locked` (403
 * `live_locked`: a product the caller does not hold sells the live, D-446), `closed` (409
 * `reminder_closed`: cancelled or started), `gone` (the bare 404, a crafted id's 400, or the module
 * switched off), a navigation the bootstrap knows (401, blocked, suspended…), or `error` with the
 * status and code for the caller's shape-only log.
 */
export type LiveReminderWrite =
  | { status: 'ok'; on: boolean }
  | { status: 'locked' }
  | { status: 'closed' }
  | { status: 'gone' }
  | { status: 'redirect'; path: string }
  | { status: 'error'; httpStatus: number | null; code: string };

async function writeLiveReminder(liveId: string, on: boolean): Promise<LiveReminderWrite> {
  try {
    const res = await apiFetch(reminderPath(liveId), { method: on ? 'PUT' : 'DELETE' });
    if (res.status === 204) return { status: 'ok', on };
    if (res.ok) return { status: 'ok', on: learnReminderSchema.parse(await res.json()).on };
    const error = await readError(res);
    if (res.status === 404 || res.status === 400) return { status: 'gone' };
    const reason = error.details?.courses;
    if (res.status === 403 && reason === 'live_locked') return { status: 'locked' };
    if (res.status === 409 && reason === 'reminder_closed') return { status: 'closed' };
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    return { status: 'error', httpStatus: res.status, code: error.code };
  } catch {
    // A transport failure: the caller logs `TRANSPORT`, never the raw error (it may carry a URL).
    return { status: 'error', httpStatus: null, code: 'TRANSPORT' };
  }
}

/** `PUT …/reminder` (08.6-05, D-444, D-445): the caller's reminder ON. No body. Never throws. */
export async function putLiveReminder(liveId: string): Promise<LiveReminderWrite> {
  return writeLiveReminder(liveId, true);
}

/** `DELETE …/reminder` (08.6-05, D-444): the caller's reminder OFF; never refused. Never throws. */
export async function deleteLiveReminder(liveId: string): Promise<LiveReminderWrite> {
  return writeLiveReminder(liveId, false);
}

/* ── 08.5-08: the lesson player's reads and writes (COURSE-19, COURSE-21, D-427..D-430) ─────── */

/**
 * Why the courses API refused an open-lesson route for the caller: `purchase` (`403 FORBIDDEN` with
 * `details.courses = 'lesson_locked'`) or `sequence` (`409 CONFLICT` with `details.courses =
 * 'lesson_sequence_locked'`). The web only reads the server's answer; it never decides a lock.
 */
export type LessonLockKind = 'purchase' | 'sequence';

/** The API's lock refusal on a lesson route, or null for any other answer. */
function lessonLock(error: ApiClientError): LessonLockKind | null {
  const reason = error.details?.courses;
  if (error.status === 403 && reason === 'lesson_locked') return 'purchase';
  if (error.status === 409 && reason === 'lesson_sequence_locked') return 'sequence';
  return null;
}

/** Every lesson route's refusals, in the order they are read. */
export type LessonRefusal =
  | { status: 'locked'; reason: LessonLockKind }
  | { status: 'not_found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error'; httpStatus: number | null; code: string };

/**
 * One refusal of a lesson route → its outcome: the module switched off (`disabled`), a bare 404 or
 * a 400 for a crafted id (`not_found` — a removed lesson, one under a removed module, or another
 * tenant's), the lock answers (`locked`), a refusal the bootstrap knows (`redirect`), else `error`
 * with the status and code for the caller's shape-only log.
 */
function lessonRefusal(error: ApiClientError): LessonRefusal {
  if (error.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
  if (error.status === 404 || error.status === 400) return { status: 'not_found' };
  const lock = lessonLock(error);
  if (lock) return { status: 'locked', reason: lock };
  const path = bootstrapRedirectPath(error);
  if (path) return { status: 'redirect', path };
  return { status: 'error', httpStatus: error.status, code: error.code };
}

const lessonPath = (lessonId: string) =>
  `/v1/courses/learn/lessons/${encodeURIComponent(lessonId)}`;

export type LearnLessonResult = { status: 'ok'; lesson: LearnLesson } | LessonRefusal;

/**
 * `GET /v1/courses/learn/lessons/{lessonId}` (08.5-01, COURSE-19, D-427..D-430): an OPEN lesson as the
 * member's player reads it — the content, its ready materials (never an asset id), the caller's own
 * progress, the module's titles-only curriculum and the neighbours with their lock reasons. A lesson
 * the caller cannot open never reaches this shape: it is `locked` (`purchase` / `sequence`), and the
 * page renders the lock page from the COURSE outline instead (UI-D-431). Never throws.
 */
export async function getLearnLesson(lessonId: string): Promise<LearnLessonResult> {
  try {
    const res = await apiFetch(lessonPath(lessonId));
    if (res.ok) return { status: 'ok', lesson: learnLessonSchema.parse(await res.json()) };
    const outcome = lessonRefusal(await readError(res));
    if (outcome.status === 'error') {
      console.error('courses.learn_lesson_failed', {
        status: outcome.httpStatus,
        code: outcome.code,
      });
    }
    return outcome;
  } catch (error) {
    console.error('courses.learn_lesson_failed', { error: String(error) });
    return { status: 'error', httpStatus: null, code: 'TRANSPORT' };
  }
}

export type LessonProgressWrite =
  | { status: 'ok'; written: true; progress: ProgressResult }
  /** `204`: the API wrote nothing (an `admin_tenant`, D-422 — the preview never sends one). */
  | { status: 'ok'; written: false }
  | LessonRefusal;

/**
 * `PUT /v1/courses/learn/lessons/{lessonId}/progress` (08.5-03, D-427, COURSE-21): the caller's own
 * progress — a playback position and/or `completed: true` (the button). The body is the contract's
 * strict `progressBodySchema` shape, validated by the caller; the server clamps the position to its
 * ready duration and decides completion (`ceil(0.9 × duration)` or the button), one-way. Never
 * throws and never logs: the action and the beacon route log by shape, each in its own words.
 */
export async function putLessonProgress(
  lessonId: string,
  body: ProgressBody,
): Promise<LessonProgressWrite> {
  try {
    const res = await apiFetch(`${lessonPath(lessonId)}/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 204) return { status: 'ok', written: false };
    if (res.ok) {
      return {
        status: 'ok',
        written: true,
        progress: progressResultSchema.parse(await res.json()),
      };
    }
    return lessonRefusal(await readError(res));
  } catch {
    // A transport failure: the caller logs `TRANSPORT`, never the raw error (it may carry a URL).
    return { status: 'error', httpStatus: null, code: 'TRANSPORT' };
  }
}

export type LearnMaterialUrlResult = { status: 'ok'; material: MaterialUrl } | LessonRefusal;

/**
 * `GET /v1/courses/learn/lessons/{lessonId}/materials/{materialId}/url` (08.5-03, COURSE-19): a
 * ten-minute signed URL for a ready material of a lesson the caller can open, minted for THIS tap
 * (`Cache-Control: no-store`). The URL is returned once and never cached, logged or persisted
 * (T-08.5-31 accepts the ten-minute window). Never throws.
 */
export async function getLearnMaterialUrl(
  lessonId: string,
  materialId: string,
): Promise<LearnMaterialUrlResult> {
  try {
    const res = await apiFetch(
      `${lessonPath(lessonId)}/materials/${encodeURIComponent(materialId)}/url`,
    );
    if (res.ok) return { status: 'ok', material: materialUrlSchema.parse(await res.json()) };
    const outcome = lessonRefusal(await readError(res));
    if (outcome.status === 'error') {
      console.error('courses.learn_material_url_failed', {
        status: outcome.httpStatus,
        code: outcome.code,
      });
    }
    return outcome;
  } catch (error) {
    console.error('courses.learn_material_url_failed', { error: String(error) });
    return { status: 'error', httpStatus: null, code: 'TRANSPORT' };
  }
}
