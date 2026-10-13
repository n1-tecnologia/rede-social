import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  COURSE_ISSUE_SET,
  courseDetailSchema,
  courseInputSchema,
  courseStatusBodySchema,
  lessonInputSchema,
  lessonViewSchema,
  moduleInputSchema,
  moduleViewSchema,
} from '../contracts/index';
import { createCourse, createLesson, createModule, getCourse, setCourseStatus } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/courses', coursesRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('courses')` (404
 * `MODULE_DISABLED` when the tenant does not have the school, a missing row included, COURSE-01)
 * -> `requirePermission('courses.manage')` on EVERY route of this phase (403; `admin_tenant` only
 * by construction, D-403: the database authorises the same writes and the draft reads by the
 * `admin_tenant` claim, see `module.ts`). No member route exists in 08.3; the member phase adds
 * them without this permission.
 *
 * Route order (RESEARCH Pitfall 3): the literal-prefixed `/modules/{moduleId}/lessons` is declared
 * BEFORE any `/{courseId}` route, so a literal segment can never be read as a course id.
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
        'The created course as a `draft`, with its category, the products that open it (an entitlement to ANY of them opens the course; none means open to every member, D-404) and no module yet. The cover and the instructor photo must be ready `cover` images of this tenant.',
      content: { 'application/json': { schema: courseDetailSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.courses`: `title_required`, `title_too_long`, `instructor_required`, `tagline_too_long`, `description_too_long`, `outcomes_too_many`, `outcome_too_long`, `hours_invalid`, `level_invalid`, `cover_invalid` / `photo_invalid` (an image of this tenant that is not a ready cover image), `category_invalid` (not a category of this tenant), `product_invalid` (not an active product of this tenant) or `too_many_products` (more than 50). An unknown key is a generic `details.issues` list. Nothing is written.',
    },
    403: { description: 'The caller does not hold `courses.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the school is off for this tenant; otherwise a cover or photo asset id is unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
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
        'The manager’s course detail: the row, its category, the products that open it (newest first), its live modules in order with their live lessons (video status and duration from the asset), and the derived `moduleCount`, `lessonCount`, `durationSeconds` (ready videos only), `hasUnreadyVideo` and `unreadyLessonIds` (the lessons that block publishing).',
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
  .openapi(createLessonRoute, async (c) =>
    c.json(
      await createLesson(c.get('ctx'), c.req.valid('param').moduleId, c.req.valid('json')),
      201,
    ),
  )
  .openapi(createCourseRoute, async (c) =>
    c.json(await createCourse(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(getCourseRoute, async (c) =>
    c.json(await getCourse(c.get('ctx'), c.req.valid('param').courseId), 200),
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
