import { createRoute, z } from '@hono/zod-openapi';
import {
  learnCataloguePageSchema,
  learnCatalogueQuerySchema,
  learnCourseSchema,
  learnLessonSchema,
  learnLiveSchema,
  learnLivesPageSchema,
  learnLivesQuerySchema,
  materialUrlSchema,
  progressBodySchema,
  progressResultSchema,
} from '../contracts/index';

/**
 * The member lane's route DEFINITIONS (08.5, SC 1-3, COURSE-18..22). Registered by `routes.ts` at
 * the HEAD of the `coursesRoutes` chain, under the literal `/learn` segment, so a learn path can
 * never be read as a `/{courseId}` (R-Pitfall 3) and never collides with the admin's `/lessons/*`.
 *
 * NO `middleware`: these routes carry no permission. The module's own `requireAuth ->
 * requireModule('courses')` chain is the whole guard; the member lane is authorised by the
 * database (the tenant-pinned definer projections and the one access answer), and every role reads
 * PUBLISHED courses only (D-426). The refusal vocabulary is closed: the bare 404 for every miss,
 * `403 lesson_locked`, `409 lesson_sequence_locked`.
 */

const learnCourseParamSchema = z.object({ courseId: z.uuid() });
const learnLessonParamSchema = z.object({ lessonId: z.uuid() });
const learnMaterialParamSchema = z.object({ lessonId: z.uuid(), materialId: z.uuid() });
const learnLiveParamSchema = z.object({ liveId: z.uuid() });

export const learnCatalogueRoute = createRoute({
  method: 'get',
  path: '/learn/courses',
  request: { query: learnCatalogueQuerySchema },
  responses: {
    200: {
      description:
        'The member catalogue (D-420, D-421, D-426, D-430): this tenant’s PUBLISHED courses only (a draft or archived course is absent for every role), newest published first (`published_at desc, id desc`; a republish keeps its place), locked and open courses in ONE list. Each card carries `locked` (product-gated for the caller; false for staff and with the store off), the FULL `lessonCount` and `durationSeconds` (ready videos, integer seconds) even when locked, and the caller’s own `completedCount`. `categories` lists only the categories holding a published course, `lower(name), id`, `[]` when none. `categoryId` filters `items`; `limit` is 1..50 (20 by default); `nextCursor` is non-null exactly when another course exists. Answered with `Cache-Control: no-store`.',
      content: { 'application/json': { schema: learnCataloguePageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: `categoryId` is not a uuid, `limit` is outside 1..50, an unknown key, or a cursor this service did not issue (`cursor_invalid`).',
    },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant.' },
  },
});

export const learnCourseRoute = createRoute({
  method: 'get',
  path: '/learn/courses/{courseId}',
  request: { params: learnCourseParamSchema },
  responses: {
    200: {
      description:
        'A PUBLISHED course of this tenant as the member course page reads it (D-423, D-430): the header, `locked` (product-gated for the caller), every live module and lesson BY TITLE in course order with its `lockReason` (`purchase`, `module`, `lesson` or null) and the caller’s own progress, and the summary (`done`, `total`, `percent`, `nextLessonId`, `firstLessonId`, `firstFreeLessonId`). A locked lesson carries no description, video, material or thumbnail. Answered with `Cache-Control: no-store`.',
      content: { 'application/json': { schema: learnCourseSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for an unknown, another tenant’s, a draft or an archived course — for every role (D-426, D-23).',
    },
  },
});

export const learnLessonRoute = createRoute({
  method: 'get',
  path: '/learn/lessons/{lessonId}',
  request: { params: learnLessonParamSchema },
  responses: {
    200: {
      description:
        'An OPEN lesson as the member player reads it: the content (description, video asset id, status, duration), its ready materials (id, filename, kind, mime, bytes — never the asset id), the caller’s own progress, the module’s lessons by title with their lock reasons, the module progress and the previous / next lessons in course order. Opened by the course door (bought or free, sequence met) or by the live door (a replay of a live the caller may open, D-433). Answered with `Cache-Control: no-store`.',
      content: { 'application/json': { schema: learnLessonSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    403: {
      description:
        '`FORBIDDEN` with `details.courses = lesson_locked`: a non-free lesson of a course no product the caller holds opens. Nothing of the lesson is in the body.',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for an unknown, another tenant’s, a removed lesson, a lesson under a removed module, and a lesson of a draft or archived course (D-426, D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = lesson_sequence_locked`: the lesson’s module or lesson rule ("Exige concluir o anterior", D-428) is unmet for the caller.',
    },
  },
});

export const learnProgressRoute = createRoute({
  method: 'put',
  path: '/learn/lessons/{lessonId}/progress',
  request: {
    params: learnLessonParamSchema,
    body: { content: { 'application/json': { schema: progressBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The caller’s OWN progress on an open lesson after the write (D-427, COURSE-21): the position is clamped to the lesson’s ready video duration (0 without one) and is the last write’s; the lesson completes on `completed: true` or when the clamped position reaches 90% of the ready duration (`ceil`). `completedAt` is one-way: once set it never moves and never reverts. A free lesson writes even for a non-buyer (D-429). Concurrent writes leave one row (the primary key arbitrates). Answered with `Cache-Control: no-store`.',
      content: { 'application/json': { schema: progressResultSchema } },
    },
    204: {
      description:
        '`admin_tenant` (the “Ver como aluno” preview, D-422): nothing is written and nothing is answered. The preview never sends a write; this is the backstop.',
    },
    400: {
      description:
        '`VALIDATION_FAILED`: the id is not a uuid; `details.courses = patch_empty` for `{}`; a generic `details.issues` list for `completed: false`, a position outside 0..14400 or not an integer, or an unknown key (the body never names a user or a tenant). Nothing is written.',
    },
    403: {
      description:
        '`FORBIDDEN` with `details.courses = lesson_locked`: a non-free lesson of a course no product the caller holds opens. Nothing is written.',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for an unknown, another tenant’s, a removed lesson, a lesson under a removed module, and a lesson of a draft or archived course. Nothing is written.',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = lesson_sequence_locked`: the lesson’s module or lesson rule (D-428) is unmet for the caller — a skip. Nothing is written.',
    },
  },
});

export const learnMaterialUrlRoute = createRoute({
  method: 'get',
  path: '/learn/lessons/{lessonId}/materials/{materialId}/url',
  request: { params: learnMaterialParamSchema },
  responses: {
    200: {
      description:
        'A SHORT-LIVED signed read URL (ten minutes, `expiresAt` says when) for a ready material of a lesson the caller can open (COURSE-19). It is a bearer capability valid at the Storage edge: answered with `Cache-Control: no-store`, minted per request (two calls are two URLs), never cached, persisted or logged, and nothing is written (T-08.3-06).',
      content: { 'application/json': { schema: materialUrlSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: an id is not a uuid' },
    403: {
      description:
        '`FORBIDDEN` with `details.courses = lesson_locked`: the material’s lesson is a non-free lesson of a course no product the caller holds opens.',
    },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for an unknown, another tenant’s or removed lesson, a lesson of a draft or archived course, and a material that is unknown, another lesson’s, another tenant’s, removed or not ready (D-23).',
    },
    409: {
      description:
        '`CONFLICT` with `details.courses = lesson_sequence_locked`: the material’s lesson is locked by its module or lesson rule (D-428) for the caller.',
    },
  },
});

export const learnLivesRoute = createRoute({
  method: 'get',
  path: '/learn/lives',
  request: { query: learnLivesQuerySchema },
  responses: {
    200: {
      description:
        'The member lives agenda (D-431) on the SERVER clock. The first page (no cursor) carries the WHOLE `upcoming` group — lives live now, scheduled lives and cancelled lives whose planned end is still ahead — `startsAt asc, id asc`, and the first 20 `recorded` lives (ended, not cancelled, with a live replay lesson), `startsAt desc, id desc`; later pages carry only `recorded` (`upcoming: []`). An ended live without a replay and a cancelled live after its planned end are absent. A locked live is listed with `locked: true`; no card carries the room link or the replay lesson id. Answered with `Cache-Control: no-store`.',
      content: { 'application/json': { schema: learnLivesPageSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown key, or a cursor this service did not issue (`cursor_invalid`).',
    },
    404: { description: '`MODULE_DISABLED` when the school is off for this tenant.' },
  },
});

export const learnLiveRoute = createRoute({
  method: 'get',
  path: '/learn/lives/{liveId}',
  request: { params: learnLiveParamSchema },
  responses: {
    200: {
      description:
        'One live’s page (D-432..D-434): the card fields plus `description`, the server-decided `state` (`cancelled`, `locked`, `open`, `before`, `replay`, `ended`, in that precedence), `joinUrl` (the stored room link ONLY in the `open` state — inside `[startsAt − 15 min, startsAt + durationMin)` on the server clock, for a caller who can open the live; null otherwise), `joinOpensAt`, `endsAt`, `serverNow`, `startsToday` (in the tenant’s timezone) and `replay` (the replay lesson’s video, materials and the caller’s progress, through the live door, only in the `replay` state). A cancelled live keeps its page. Answered with `Cache-Control: no-store` (the link is time-bound).',
      content: { 'application/json': { schema: learnLiveSchema } },
    },
    400: { description: '`VALIDATION_FAILED`: the id is not a uuid' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise one identical bare body for an unknown or another tenant’s live (D-23).',
    },
  },
});
