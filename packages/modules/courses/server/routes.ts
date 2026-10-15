import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  COURSE_ISSUE_SET,
  categoryInputSchema,
  categoryListSchema,
  categoryPatchSchema,
  categorySchema,
  courseDetailSchema,
  courseInputSchema,
  courseListQuerySchema,
  coursePageSchema,
  coursePatchSchema,
  courseStatusBodySchema,
  lessonDetailSchema,
  lessonInputSchema,
  lessonListSchema,
  lessonPatchSchema,
  lessonPickerListSchema,
  lessonViewSchema,
  liveDetailSchema,
  liveInputSchema,
  liveListQuerySchema,
  livePageSchema,
  livePatchSchema,
  materialsBodySchema,
  materialUrlSchema,
  moduleInputSchema,
  moduleListSchema,
  modulePatchSchema,
  moduleViewSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  reorderTrackCoursesSchema,
  trackDetailSchema,
  trackInputSchema,
  trackListQuerySchema,
  trackPageSchema,
  trackPatchSchema,
  trackStatusBodySchema,
} from '../contracts/index';
import { learnCourseRoute, learnLessonRoute } from './learn-routes';
import { getLearnCourse, getLearnLesson } from './learn-service';
import {
  cancelLive,
  createCategory,
  createCourse,
  createLesson,
  createLive,
  createModule,
  createTrack,
  deleteCategory,
  deleteLesson,
  deleteModule,
  getCourse,
  getLesson,
  getLive,
  getTrack,
  listCategories,
  listCourses,
  listLessonsForPicker,
  listLives,
  listTracks,
  materialUrl,
  reorderLessons,
  reorderModules,
  replaceMaterials,
  replaceTrackCourses,
  setCourseStatus,
  setTrackStatus,
  updateCategory,
  updateCourse,
  updateLesson,
  updateLive,
  updateModule,
  updateTrack,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/courses', coursesRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('courses')` (404
 * `MODULE_DISABLED` when the tenant does not have the school, a missing row included, COURSE-01)
 * -> on every MANAGEMENT route, `requirePermission('courses.manage')` (403; `admin_tenant` only by
 * construction, D-403: the database authorises the same writes and the draft reads by the
 * `admin_tenant` claim, see `module.ts`).
 *
 * The MEMBER routes (08.5, `learn-routes.ts`) live under the literal `/learn` segment and carry NO
 * permission: any member of the tenant reaches them, and what they answer is decided by the
 * database — the tenant-pinned definer projections and the one access answer
 * (`app.course_lesson_access`), published courses only for every role (D-426). Every other route
 * keeps `courses.manage`.
 *
 * Route order (RESEARCH Pitfall 3): the `/learn/*` routes come FIRST, then the literal-prefixed
 * routes (`/categories*`, `/tracks*`, `/lives*`, `/modules/*`, `/lessons`, `/lessons/*`), all
 * declared BEFORE any `/{courseId}` route, so a literal segment can never be read as a course id.
 */

/**
 * A Zod issue whose `message` is a courses machine code is lifted to `details.courses` (the store
 * `defaultHook` precedent); anything else is the generic `details.issues` list.
 */
const courses = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const issue = result.error.issues
        .map((candidate) => candidate.message)
        .find((message) => COURSE_ISSUE_SET.has(message));
      if (issue) throw new ApiError(400, 'VALIDATION_FAILED', { courses: issue });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((candidate) => ({
          path: candidate.path.map(String).join('.'),
          message: candidate.message,
        })),
      });
    }
  },
});

courses.use('*', requireAuth, requireModule('courses'));

const courseParamSchema = z.object({ courseId: z.uuid() });
const moduleParamSchema = z.object({ moduleId: z.uuid() });
const lessonParamSchema = z.object({ lessonId: z.uuid() });
const materialParamSchema = z.object({ lessonId: z.uuid(), materialId: z.uuid() });
const categoryParamSchema = z.object({ categoryId: z.uuid() });
const trackParamSchema = z.object({ trackId: z.uuid() });
const liveParamSchema = z.object({ liveId: z.uuid() });

// ── Categories (D-411, COURSE-04) — declared BEFORE any `/{courseId}` route (Pitfall 3). ─────────

const listCategoriesRoute = createRoute({
  method: 'get',
  path: '/categories',
  middleware: [requirePermission('courses.manage')] as const,
  responses: {
    200: {
      description:
        'Every category of this tenant, ordered by name ignoring case then id. `courseCount` counts the tenant’s NON-archived courses in the category (the hub chip); the delete refusal counts every course, archived ones included, so the two may differ.',
      content: { 'application/json': { schema: categoryListSchema } },
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const createCategoryRoute = createRoute({
  method: 'post',
  path: '/categories',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: categoryInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created category with `courseCount: 0`. The name is trimmed and capped at 60 code points; the cover, when sent, must be a ready `cover` image of this tenant.',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long` or `cover_invalid` (not a ready `cover` image of this tenant — an unknown or another tenant’s id answers this code, by name). An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.courses = category_exists`: another category of this tenant has the same name ignoring case. Nothing is written.',
    },
  },
});

const updateCategoryRoute = createRoute({
  method: 'patch',
  path: '/categories/{categoryId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: categoryParamSchema,
    body: { content: { 'application/json': { schema: categoryPatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The category after the edit, with its count. Only the keys present change; `coverAssetId: null` removes the cover.',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `cover_invalid` or `patch_empty`. An unknown key is a generic `details.issues` list.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no category with this id belongs to this tenant. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = category_exists`: the new name collides with ANOTHER category of this tenant ignoring case (renaming to the same name in another case is allowed).',
    },
  },
});

const deleteCategoryRoute = createRoute({
  method: 'delete',
  path: '/categories/{categoryId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: categoryParamSchema },
  responses: {
    204: {
      description:
        'The empty category was removed. A category with courses is never removed (see 409); courses are never touched by this route.',
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no category with this id belongs to this tenant. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = category_in_use` and `details.courseCount`: at least one course of this tenant — archived ones included — references the category. Detach the courses (`PATCH /{courseId} { categoryId: null }`) first. Nothing is written.',
    },
  },
});

// ── Tracks (D-414, D-415, COURSE-10) — `/tracks*` literals BEFORE any `/{courseId}` route. ───────

const listTracksRoute = createRoute({
  method: 'get',
  path: '/tracks',
  middleware: [requirePermission('courses.manage')] as const,
  request: { query: trackListQuerySchema },
  responses: {
    200: {
      description:
        'The Trilhas tab, newest first on a keyset over `(created_at desc, id desc)`: `filter=active` (the default) or `archived`, one status each. `limit` is 1..50 (20 by default); `nextCursor` is non-null exactly when another row exists. `courseCount` counts ONLY the linked courses that are `published` right now (D-415: an unpublished or archived course drops out at read time; its link row stays).',
      content: { 'application/json': { schema: trackPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: a filter outside the two, a `limit` outside 1..50, a cursor longer than 512 characters or one this service never issued (`cursor_invalid`), or an unknown query key. Never a widened read.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const createTrackRoute = createRoute({
  method: 'post',
  path: '/tracks',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: trackInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created track as `active` with no course yet (`courses: []`, `courseCount: 0`). A track has no lessons, hours or certificate of its own (D-415): it is a path over published courses, written afterwards by `PUT …/order`. The cover, when sent, must be a ready `cover` image of this tenant.',
      content: { 'application/json': { schema: trackDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `tagline_too_long` (the subtitle over 160 or the audience over 60), `description_too_long` (over 2 000) or `cover_invalid` (not a ready `cover` image of this tenant — an unknown or another tenant’s id answers this code, by name). An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const getTrackRoute = createRoute({
  method: 'get',
  path: '/tracks/{trackId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: trackParamSchema },
  responses: {
    200: {
      description:
        'The manager’s track detail: the row and EVERY linked course by `position, id` with its CURRENT `status` (the admin read — the form marks a course that is no longer published and leaves it out of the next save; the member read of the next phase filters `published`). `courseCount` counts the published ones only, so it may be smaller than `courses.length`.',
      content: { 'application/json': { schema: trackDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no track with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const updateTrackRoute = createRoute({
  method: 'patch',
  path: '/tracks/{trackId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: trackParamSchema,
    body: { content: { 'application/json': { schema: trackPatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The track detail after the edit, under the row lock. Only the keys present change; `coverAssetId: null` removes the cover. The course list never travels here: membership and order have ONE write path, `PUT …/order` (D-414).',
      content: { 'application/json': { schema: trackDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `tagline_too_long`, `description_too_long`, `cover_invalid` or `patch_empty`. An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no track with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const setTrackStatusRoute = createRoute({
  method: 'put',
  path: '/tracks/{trackId}/status',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: trackParamSchema,
    body: { content: { 'application/json': { schema: trackStatusBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The track detail after the transition, idempotent: `active → archived` sets `archivedAt` and never deletes (the link rows stay); `archived → active` clears it (allowed for tracks — D-413’s no-way-back is about courses). The status the track already has answers the unchanged detail.',
      content: { 'application/json': { schema: trackDetailSchema } },
    },
    400: {
      description: '`VALIDATION_FAILED`: the id is not a uuid, or the status is not one of the two',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no track with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

/**
 * The track's WHOLE course list — membership AND order — as ONE body (D-414, D-415, RESEARCH A8).
 * `PUT` because the body REPLACES the set and a repeat of it is a no-op.
 */
const replaceTrackCoursesRoute = createRoute({
  method: 'put',
  path: '/tracks/{trackId}/order',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: trackParamSchema,
    body: {
      content: { 'application/json': { schema: reorderTrackCoursesSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'The track detail with its courses REPLACED by `ids`, in body order (`position` 1..N), under the track row lock: a course absent from `ids` is unlinked, one present but not yet linked is linked, every id a PUBLISHED course of this tenant. `[]` clears the membership. A re-sent identical list keeps its rows (`created_at` untouched, zero rows renumbered). A course may belong to several tracks. An archived or unpublished course keeps its link row and drops out of the member read only (D-415).',
      content: { 'application/json': { schema: trackDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses = course_invalid`: an id is not a uuid, or not a PUBLISHED course of this tenant — a draft, an archived, an unknown and another tenant’s id answer this one code (T-08.3-02). A duplicate id, more than 200 ids or an unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no track with this id belongs to this tenant — decided BEFORE any course is read. One bare code, no details (D-23).',
    },
  },
});

// ── Lives (D-416, COURSE-11) — `/lives*` literals BEFORE any `/{courseId}` route. ────────────────

const listLivesRoute = createRoute({
  method: 'get',
  path: '/lives',
  middleware: [requirePermission('courses.manage')] as const,
  request: { query: liveListQuerySchema },
  responses: {
    200: {
      description:
        'The Lives tab: `filter=upcoming` (the default) lists the lives whose END (`startsAt + durationMin`) is still ahead, soonest first on a keyset over `(starts_at asc, id asc)`; `filter=past` the ended ones, latest first. A cancelled live stays in its time bucket. Each row’s `status` is DERIVED at answer time by `liveStatusAt` (`scheduled | live | recorded | cancelled`) — the table has no status column (D-416). `limit` is 1..50 (20 by default); `nextCursor` is non-null exactly when another row exists.',
      content: { 'application/json': { schema: livePageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: a filter outside the two, a `limit` outside 1..50, a cursor longer than 512 characters or one this service never issued (`cursor_invalid`), or an unknown query key. Never a widened read.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const createLiveRoute = createRoute({
  method: 'post',
  path: '/lives',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: liveInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The scheduled live: title 1..120, description ≤ 2 000, an optional ready `cover`, `startsAt` as an ISO instant WITH offset (the form builds it in the tenant timezone), `durationMin` 5..600 and an `https` `externalUrl` (any: YouTube, Zoom, Meet). The body carries no product link: the product form is the only writer (D-418), so a new live is open to every member until a product links it. A start in the past is accepted — the live reads `recorded` at once. Nothing streams in the app and nobody is notified (D-416).',
      content: { 'application/json': { schema: liveDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `description_too_long`, `start_required` (a missing, malformed or impossible instant), `duration_invalid` (outside 5..600 or not an integer), `url_invalid` (not `https://…` — `http:`, `javascript:`, `ftp:` and a bare host alike, T-08.3-11), or `cover_invalid`. An unknown key (the old product link key included) is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const getLiveRoute = createRoute({
  method: 'get',
  path: '/lives/{liveId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: liveParamSchema },
  responses: {
    200: {
      description:
        'The manager’s live detail: the fields, the DERIVED `status`, `cancelledAt`, `products`, the store products that open it (store catalogue order, with their `status`; written only by the product form, D-418) and `replayLesson { id, title, courseTitle }` or null.',
      content: { 'application/json': { schema: liveDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no live with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const updateLiveRoute = createRoute({
  method: 'patch',
  path: '/lives/{liveId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: liveParamSchema,
    body: { content: { 'application/json': { schema: livePatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The live detail after the edit, under the row lock. Only the keys present change; `coverAssetId: null` removes the cover; `replayLessonId` points the replay at a LIVE lesson of this tenant (`null` clears it) and is accepted only once the live has ENDED by the values the patch leaves it with (RESEARCH A5). No product link is accepted here (D-418: the product form is the only writer; the old link key is a 400). The same patch twice leaves the row as it was (P44).',
      content: { 'application/json': { schema: liveDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: the create body’s codes, `lesson_invalid` (not a live lesson of this tenant — an unknown, removed or another tenant’s id, by name) or `patch_empty`. An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no live with this id belongs to this tenant. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = live_cancelled`: the live was cancelled (before this patch or by a cancel that landed first, P45) and nothing about it changes any more; or `replay_too_early`: a non-null `replayLessonId` on a live that has not ended yet. Nothing is written.',
    },
  },
});

const cancelLiveRoute = createRoute({
  method: 'post',
  path: '/lives/{liveId}/cancel',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: liveParamSchema },
  responses: {
    200: {
      description:
        'The live detail as `cancelled`: `cancelledAt` is set ONCE (`coalesce(cancelled_at, now())` under the row lock) — a second call, or two concurrent ones, answer 200 with the SAME instant (P44, P45). Never a delete: the live stays in its time bucket with the “Cancelada” pill, and nobody is notified (D-416).',
      content: { 'application/json': { schema: liveDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no live with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

// The replay picker's read — the `/lessons` literal BEFORE `/lessons/{lessonId}` (Pitfall 3).
const listLessonsForPickerRoute = createRoute({
  method: 'get',
  path: '/lessons',
  middleware: [requirePermission('courses.manage')] as const,
  responses: {
    200: {
      description:
        'The tenant’s LIVE lessons under live modules for the replay picker: `{ items: [{ id, title, courseId, courseTitle, videoStatus }] }`, course newest first, then module position, then lesson position, capped at 200. Every course status is listed.',
      content: { 'application/json': { schema: lessonPickerListSchema } },
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

// Declared BEFORE any `/{courseId}` route, so the literal `/modules` prefix always wins (Pitfall 3).
const createLessonRoute = createRoute({
  method: 'post',
  path: '/modules/{moduleId}/lessons',
  // The literal, not `COURSE_PERMISSIONS.manage`: this string is the one thing a reviewer greps for
  // when asking "what guards adding a lesson?", and an indirection here hides a change (T-06-02).
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: moduleParamSchema,
    body: { content: { 'application/json': { schema: lessonInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created lesson at the next position of its module. `videoAssetId` is a `lesson`-purpose video asset of this tenant in any status (null for a practice lesson); `videoStatus` mirrors the asset (`pending` right after an upload starts) and `durationSeconds` is set only once it is `ready`. A lesson with a video that is not ready blocks publishing the course until the provider reports it ready.',
      content: { 'application/json': { schema: lessonViewSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `description_too_long`, `video_invalid` (not a `lesson` video asset of this tenant — an unknown or another tenant’s id answers this code, by name) or `video_in_use` (already the video of another live lesson). An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the module is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

// ── Lessons (COURSE-06, D-407, D-409, D-414) — `/lessons/*` literals BEFORE any `/{courseId}` route.

const getLessonRoute = createRoute({
  method: 'get',
  path: '/lessons/{lessonId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: lessonParamSchema },
  responses: {
    200: {
      description:
        'The lesson form’s reading: the lesson (video status and duration from the asset row), its materials by `position, id` (each with the stored `filename`, `mime`, the derived `kind` and `bytes`), the module it sits in and the course it belongs to with `hasProducts` (whether "Aula aberta" means anything, D-407).',
      content: { 'application/json': { schema: lessonDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the lesson is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const updateLessonRoute = createRoute({
  method: 'patch',
  path: '/lessons/{lessonId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: lessonParamSchema,
    body: { content: { 'application/json': { schema: lessonPatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The lesson detail after the edit. Only the keys present change. `videoAssetId` links a `lesson`-purpose video asset of this tenant in ANY status (D-409: the only video source is a direct upload; nothing about the video is typed — `videoStatus` and `durationSeconds` are read from the asset row) or `null` to detach it. The same body twice leaves the row (`updatedAt` aside).',
      content: { 'application/json': { schema: lessonDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `description_too_long`, `video_invalid` (not a `lesson` video asset of this tenant — an unknown or another tenant’s id answers this code, by name), `video_in_use` (already the video of ANOTHER live lesson; a soft-deleted lesson frees its asset) or `patch_empty`. An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the lesson is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const deleteLessonRoute = createRoute({
  method: 'delete',
  path: '/lessons/{lessonId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: lessonParamSchema },
  responses: {
    204: {
      description:
        'The lesson was REMOVED, never deleted: `deleted_at` is set and the row stays, with its materials rows and every member progress row (D-408). Its video asset becomes free for another lesson. The remaining lessons keep their relative order with a gap in `position` until the next `PUT …/lessons/order`. A second call is the bare 404.',
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the lesson is unknown, another tenant’s, or already removed. One bare code, no details (D-23).',
    },
  },
});

const reorderLessonsRoute = createRoute({
  method: 'put',
  path: '/modules/{moduleId}/lessons/order',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: moduleParamSchema,
    body: { content: { 'application/json': { schema: reorderLessonsSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The module’s live lessons in the new order (D-414). `position` becomes 1..N in the order of `ids`, in ONE statement under a lock on the module and its live lessons; only rows whose position really changes are written, so repeating the same order writes nothing.',
      content: { 'application/json': { schema: lessonListSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: `ids` is empty, longer than 200, holds something that is not a uuid, or names the same lesson twice; or the body has another key. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the module is unknown, another tenant’s, or removed — decided BEFORE any lesson is read. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = order_stale`: `ids` is not exactly the module’s current live lessons — one was added or removed since the list was loaded, or an id is unknown or another tenant’s (one answer for all of them, so no existence oracle). Nothing is written; reload and try again.',
    },
  },
});

// ── Materials (COURSE-07, D-410) ──────────────────────────────────────────────────────────────────

const replaceMaterialsRoute = createRoute({
  method: 'put',
  path: '/lessons/{lessonId}/materials',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: lessonParamSchema,
    body: { content: { 'application/json': { schema: materialsBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The lesson detail with its materials REPLACED by `assetIds`, in body order (`position` 1..N): at most 10, every one a READY `attachment` file of this tenant (D-410: PDF, spreadsheets, slides, images at 50 MiB, judged at upload). `[]` clears the set. Written under the lesson row lock; a re-sent identical set keeps its rows. `kind` is derived from each asset’s mime, `filename` and `bytes` are the asset’s.',
      content: { 'application/json': { schema: lessonDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `too_many_materials` (more than 10), `material_invalid` (a non-uuid, or an asset of this tenant that is not a ready `attachment` file — a cover, a pending or rejected upload). A duplicate id or an unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the lesson is unknown, another tenant’s or removed, OR an asset id is unknown, another tenant’s or removed. One bare code, no details (D-23). Nothing is written.',
    },
  },
});

const materialUrlRoute = createRoute({
  method: 'get',
  path: '/lessons/{lessonId}/materials/{materialId}/url',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: materialParamSchema },
  responses: {
    200: {
      description:
        'A SHORT-LIVED signed read URL for the material’s object, minted per request (ten minutes, `expiresAt` says when). It is a bearer capability valid at the Storage edge: answered with `Cache-Control: no-store`, never cached, persisted, logged or shared (T-08.3-06). Two calls are two URLs.',
      content: { 'application/json': { schema: materialUrlSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: an id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for every miss: an unknown material, a material of another lesson, of another tenant, of a removed lesson or of a removed asset (D-23).',
    },
  },
});

// ── Modules (COURSE-05, D-406, D-414) — `/modules/*` literals BEFORE any `/{courseId}` route. ────

const updateModuleRoute = createRoute({
  method: 'patch',
  path: '/modules/{moduleId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: moduleParamSchema,
    body: { content: { 'application/json': { schema: modulePatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The module after the edit, with its live lessons. Only the keys present change. `requiresPrevious` ("Exige concluir o módulo anterior", D-406) is stored as sent, except on the FIRST module of the course, where it is forced to `false` and answered as such (there is no previous module to complete). Two modules may share a title.',
      content: { 'application/json': { schema: moduleViewSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `description_too_long` (the summary) or `patch_empty`. An unknown key is a generic `details.issues` list.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the module is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const deleteModuleRoute = createRoute({
  method: 'delete',
  path: '/modules/{moduleId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: moduleParamSchema },
  responses: {
    204: {
      description:
        'The module was REMOVED, never deleted: `deleted_at` is set and the row stays. Its lessons keep their rows and every member progress row stays (D-408); they leave every list because the module is gone. The remaining modules keep their relative order with a gap in `position` until the next `PUT …/modules/order` renumbers them. A second call is the bare 404.',
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise the module is unknown, another tenant’s, or already removed. One bare code, no details (D-23).',
    },
  },
});

/**
 * The admin's order of a course's live modules, as ONE full permutation (D-414, the communities
 * `PUT /order` rule). `PUT` because the body REPLACES the whole order and a repeat of it is a no-op.
 */
const reorderModulesRoute = createRoute({
  method: 'put',
  path: '/{courseId}/modules/order',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: courseParamSchema,
    body: { content: { 'application/json': { schema: reorderModulesSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The course’s live modules in the new order, with their lessons. `position` becomes 1..N in the order of `ids`, in ONE statement under a lock on the course and its live modules; only rows whose position really changes are written, so repeating the same order writes nothing (not even `updated_at`).',
      content: { 'application/json': { schema: moduleListSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: `ids` is empty, longer than 200, holds something that is not a uuid, or names the same module twice; or the body has another key. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no course with this id belongs to this tenant — decided BEFORE any module is read. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = order_stale`: `ids` is not exactly the course’s current live modules — one was added or removed since the list was loaded, or an id is unknown or another tenant’s (one answer for all of them, so no existence oracle). Nothing is written; reload the course and try again.',
    },
  },
});

const createCourseRoute = createRoute({
  method: 'post',
  path: '/',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: courseInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created course as a `draft`, with its category, `products: []` (the body carries no product link: the product form is the only writer, D-418, so a new course is open to every member until a product links it) and no module yet. The cover and the instructor photo must be ready `cover` images of this tenant.',
      content: { 'application/json': { schema: courseDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `instructor_required`, `tagline_too_long`, `description_too_long`, `outcomes_too_many`, `outcome_too_long`, `hours_invalid`, `level_invalid`, `cover_invalid` / `photo_invalid` (not a ready `cover` image of this tenant — an unknown or another tenant’s id answers this code, by name), or `category_invalid` (not a category of this tenant). An unknown key (the old product link key included) is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const listCoursesRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [requirePermission('courses.manage')] as const,
  request: { query: courseListQuerySchema },
  responses: {
    200: {
      description:
        'The admin catalogue, newest first on a keyset over `(created_at desc, id desc)`: `filter=all` (the default) lists drafts and published courses, `draft` / `published` / `archived` one status each. `limit` is 1..50 (20 by default); `nextCursor` is non-null exactly when another row exists. Each row carries the counts the hub shows — live modules, live lessons, the ready videos’ seconds, `hasUnreadyVideo` — computed with the row, plus the category name and `publishedAt`.',
      content: { 'application/json': { schema: coursePageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: a filter outside the four, a `limit` outside 1..50, a cursor longer than 512 characters or one this service never issued (`cursor_invalid`), or an unknown query key. Never a widened read.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant' },
  },
});

const getCourseRoute = createRoute({
  method: 'get',
  path: '/{courseId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: { params: courseParamSchema },
  responses: {
    200: {
      description:
        'The manager’s course detail: the row, its category, `products`, the store products that open it (newest first; written only by the product form, D-418), its live modules in order with their live lessons (video status and duration from the asset), and the derived `moduleCount`, `lessonCount`, `durationSeconds` (ready videos only), `hasUnreadyVideo` and `unreadyLessonIds` (the lessons that block publishing).',
      content: { 'application/json': { schema: courseDetailSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no course with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const updateCourseRoute = createRoute({
  method: 'patch',
  path: '/{courseId}',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: courseParamSchema,
    body: { content: { 'application/json': { schema: coursePatchSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The manager’s detail after the edit (COURSE-08). ONE transaction under the course row lock: only the keys present change; `categoryId: null` detaches the category, `coverAssetId` / `instructorPhotoAssetId: null` remove the image. No product link is accepted here (D-418: the product form is the only writer of a course-to-product link; the old link key is a 400). The same body twice leaves the row unchanged (`updatedAt` aside).',
      content: { 'application/json': { schema: courseDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: the field codes of `POST /` (`title_required`, `instructor_required`, `title_too_long`, …), `cover_invalid` / `photo_invalid` (not a ready `cover` image of this tenant — unknown and foreign ids by name), `category_invalid`, or `patch_empty` (a body whose only key is unknown, the old product link key included, answers this code). An unknown key beside a valid field is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no course with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const createModuleRoute = createRoute({
  method: 'post',
  path: '/{courseId}/modules',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: courseParamSchema,
    body: { content: { 'application/json': { schema: moduleInputSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The created module at the next position of the course (1 for the first). `requiresPrevious` ("Exige concluir o módulo anterior", D-406) is stored as sent, except on the FIRST module, where it is always false: there is no previous module to complete. Modeled now, enforced in the member phase.',
      content: { 'application/json': { schema: moduleViewSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long` or `description_too_long` (the summary). An unknown key is a generic `details.issues` list.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no course with this id belongs to this tenant. One bare code, no details (D-23).',
    },
  },
});

const setCourseStatusRoute = createRoute({
  method: 'put',
  path: '/{courseId}/status',
  middleware: [requirePermission('courses.manage')] as const,
  request: {
    params: courseParamSchema,
    body: { content: { 'application/json': { schema: courseStatusBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The course detail after the transition (D-413): `draft → published` sets `publishedAt` on the first publish and keeps it through a later unpublish; `published → draft` unpublishes; `draft | published → archived` sets `archivedAt` and never deletes. The status the course already has answers the unchanged detail (idempotent, `updatedAt` untouched).',
      content: { 'application/json': { schema: courseDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid, or the status is not one of the three',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise no course with this id belongs to this tenant. One bare code, no details (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = video_not_ready` and `details.lessonIds`: publishing while at least one live lesson’s video is not `ready` (pending, processing, failed, or an asset the lane no longer sees). Nothing is written; the course stays as it was. Or `details.courses = status_invalid`: a transition out of `archived`.',
    },
  },
});

export const coursesRoutes = courses
  // 08.5 member lane FIRST (R-Pitfall 3): `/learn/*` literals before every other route.
  .openapi(learnCourseRoute, async (c) => {
    const answer = await getLearnCourse(c.get('ctx'), c.req.valid('param').courseId);
    // The caller's own progress rides the body: never a shared cache.
    c.header('Cache-Control', 'no-store');
    return c.json(answer, 200);
  })
  .openapi(learnLessonRoute, async (c) => {
    const answer = await getLearnLesson(c.get('ctx'), c.req.valid('param').lessonId);
    // An opened paid lesson's content and the caller's progress: never a shared cache.
    c.header('Cache-Control', 'no-store');
    return c.json(answer, 200);
  })
  .openapi(listCategoriesRoute, async (c) => c.json(await listCategories(c.get('ctx')), 200))
  .openapi(createCategoryRoute, async (c) =>
    c.json(await createCategory(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updateCategoryRoute, async (c) =>
    c.json(
      await updateCategory(c.get('ctx'), c.req.valid('param').categoryId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(deleteCategoryRoute, async (c) => {
    await deleteCategory(c.get('ctx'), c.req.valid('param').categoryId);
    return c.body(null, 204);
  })
  .openapi(listTracksRoute, async (c) =>
    c.json(await listTracks(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createTrackRoute, async (c) =>
    c.json(await createTrack(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(getTrackRoute, async (c) =>
    c.json(await getTrack(c.get('ctx'), c.req.valid('param').trackId), 200),
  )
  .openapi(updateTrackRoute, async (c) =>
    c.json(await updateTrack(c.get('ctx'), c.req.valid('param').trackId, c.req.valid('json')), 200),
  )
  .openapi(setTrackStatusRoute, async (c) =>
    c.json(
      await setTrackStatus(c.get('ctx'), c.req.valid('param').trackId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(replaceTrackCoursesRoute, async (c) =>
    c.json(
      await replaceTrackCourses(c.get('ctx'), c.req.valid('param').trackId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(listLivesRoute, async (c) =>
    c.json(await listLives(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createLiveRoute, async (c) =>
    c.json(await createLive(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(getLiveRoute, async (c) =>
    c.json(await getLive(c.get('ctx'), c.req.valid('param').liveId), 200),
  )
  .openapi(updateLiveRoute, async (c) =>
    c.json(await updateLive(c.get('ctx'), c.req.valid('param').liveId, c.req.valid('json')), 200),
  )
  .openapi(cancelLiveRoute, async (c) =>
    c.json(await cancelLive(c.get('ctx'), c.req.valid('param').liveId), 200),
  )
  .openapi(listLessonsForPickerRoute, async (c) =>
    c.json(await listLessonsForPicker(c.get('ctx')), 200),
  )
  .openapi(createLessonRoute, async (c) =>
    c.json(
      await createLesson(c.get('ctx'), c.req.valid('param').moduleId, c.req.valid('json')),
      201,
    ),
  )
  .openapi(getLessonRoute, async (c) =>
    c.json(await getLesson(c.get('ctx'), c.req.valid('param').lessonId), 200),
  )
  .openapi(updateLessonRoute, async (c) =>
    c.json(
      await updateLesson(c.get('ctx'), c.req.valid('param').lessonId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(deleteLessonRoute, async (c) => {
    await deleteLesson(c.get('ctx'), c.req.valid('param').lessonId);
    return c.body(null, 204);
  })
  .openapi(replaceMaterialsRoute, async (c) =>
    c.json(
      await replaceMaterials(c.get('ctx'), c.req.valid('param').lessonId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(materialUrlRoute, async (c) => {
    const { lessonId, materialId } = c.req.valid('param');
    const answer = await materialUrl(c.get('ctx'), lessonId, materialId);
    // NEVER cacheable: this body carries a bearer capability that is valid outside our
    // infrastructure, so a shared cache holding one would hand a gated material to whoever reads
    // that cache (T-08.3-06, the playback route's rule).
    c.header('Cache-Control', 'no-store');
    return c.json(answer, 200);
  })
  .openapi(reorderLessonsRoute, async (c) =>
    c.json(
      await reorderLessons(c.get('ctx'), c.req.valid('param').moduleId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(updateModuleRoute, async (c) =>
    c.json(
      await updateModule(c.get('ctx'), c.req.valid('param').moduleId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(deleteModuleRoute, async (c) => {
    await deleteModule(c.get('ctx'), c.req.valid('param').moduleId);
    return c.body(null, 204);
  })
  .openapi(reorderModulesRoute, async (c) =>
    c.json(
      await reorderModules(c.get('ctx'), c.req.valid('param').courseId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(listCoursesRoute, async (c) =>
    c.json(await listCourses(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(createCourseRoute, async (c) =>
    c.json(await createCourse(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(getCourseRoute, async (c) =>
    c.json(await getCourse(c.get('ctx'), c.req.valid('param').courseId), 200),
  )
  .openapi(updateCourseRoute, async (c) =>
    c.json(
      await updateCourse(c.get('ctx'), c.req.valid('param').courseId, c.req.valid('json')),
      200,
    ),
  )
  .openapi(createModuleRoute, async (c) =>
    c.json(
      await createModule(c.get('ctx'), c.req.valid('param').courseId, c.req.valid('json')),
      201,
    ),
  )
  .openapi(setCourseStatusRoute, async (c) =>
    c.json(
      await setCourseStatus(c.get('ctx'), c.req.valid('param').courseId, c.req.valid('json')),
      200,
    ),
  );
