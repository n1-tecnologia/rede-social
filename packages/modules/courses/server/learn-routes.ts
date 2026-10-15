import { createRoute, z } from '@hono/zod-openapi';
import { learnCourseSchema, learnLessonSchema } from '../contracts/index';

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
