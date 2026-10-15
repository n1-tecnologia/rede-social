import { attachmentKindFor } from '@rede-social/contracts/media';
import { z } from 'zod';

/**
 * The courses module's published contract surface (`@rede-social/module-courses/contracts`). The
 * API validates bodies with these schemas and the web (plan 06 on) parses answers with them, so
 * there is exactly one definition of what a course, a module and a lesson are (MOD-01).
 *
 * Three facts a reader must not "fix":
 *
 * 1. **A lesson's video is an asset id, never a URL** (D-409). The lesson form uploads through the
 *    existing direct-to-provider pipeline as a `lesson`-purpose `media_assets` row; the API links
 *    the id and copies `durationSeconds` from the ready asset. Playback is signed; no external link.
 * 2. **Only the course has a publication state** (D-413): `draft → published → archived`, unpublish
 *    back to `draft`. Modules and lessons inherit it. Publishing is refused with
 *    `409 { courses: 'video_not_ready', lessonIds }` while any lesson's video is not `ready`.
 * 3. **Derived, never stored:** a lesson's kind (video vs practice: the presence of a video), a
 *    course's duration (the sum of its ready videos), a live's status (the clock).
 */

/**
 * Field caps, measured on the TRIMMED string, the communities rule. One precision (08.2-05, P09):
 * Zod 4's `.max()` counts CODE POINTS, while the browser `maxLength` and a JS `.length` counter
 * count UTF-16 code units. The two agree on every character of the Basic Multilingual Plane; an
 * astral character (an emoji) counts twice in the browser and once here, so the form is the
 * stricter side and never sends a value the API refuses.
 */
export const COURSE_MAX_TITLE = 120;
export const COURSE_MAX_TAGLINE = 160;
export const COURSE_MAX_DESCRIPTION = 5000;
/** "O que você vai dominar": at most 10 bullets of at most 120 characters each. */
export const COURSE_MAX_OUTCOMES = 10;
export const COURSE_MAX_OUTCOME = 120;
/** Optional certificate hours, 0..999. */
export const COURSE_MAX_HOURS = 999;
export const MODULE_MAX_TITLE = 120;
export const MODULE_MAX_SUMMARY = 500;
export const LESSON_MAX_TITLE = 120;
export const LESSON_MAX_DESCRIPTION = 2000;
/** D-410: up to 10 materials per lesson. */
export const LESSON_MAX_MATERIALS = 10;
export const CATEGORY_MAX_NAME = 60;
export const TRACK_MAX_TITLE = 120;
export const TRACK_MAX_SUBTITLE = 160;
export const TRACK_MAX_AUDIENCE = 60;
export const TRACK_MAX_DESCRIPTION = 2000;
export const LIVE_MAX_TITLE = 120;
export const LIVE_MAX_DESCRIPTION = 2000;
/** A live's planned duration, in minutes (D-416). */
export const LIVE_MIN_DURATION = 5;
export const LIVE_MAX_DURATION = 600;

/**
 * The closed refusal vocabulary, lifted into `details.courses`:
 *  - `400 VALIDATION_FAILED`: the field codes (`title_required` … `too_many_materials`), the
 *    reference codes (`cover_invalid`, `photo_invalid`: not a ready `cover` image of THIS tenant —
 *    unknown and foreign ids answer THIS code, not a 404, so a cross-tenant asset id is refused by
 *    name (08.3-04, T-08.3-02); `category_invalid`, `lesson_invalid`,
 *    `course_invalid`: not a usable row of this tenant, or not a uuid; `video_invalid`: not a
 *    `lesson` video asset of this tenant — same by-name rule; `video_in_use`: already linked to a
 *    live lesson), `patch_empty`;
 *  - `409 CONFLICT`: `video_not_ready` (publishing while a lesson's video processes; `lessonIds`
 *    rides beside it), `status_invalid` (a transition out of `archived`), `category_exists`,
 *    `category_in_use`, `order_stale`, `live_cancelled` (a write on a cancelled live, A6),
 *    `replay_too_early` (a replay set before the live has ended, A5), and (08.5, the member lane)
 *    `lesson_sequence_locked` (a lesson the caller may not open yet: its module or lesson
 *    "Exige concluir o anterior" rule is unmet, D-428);
 *  - `403 FORBIDDEN`: `lesson_locked` (08.5: a non-free lesson of a course no product the caller
 *    holds opens, D-423).
 * Later plans use the codes this tracer does not reach yet; the set is closed from day one so the
 * web can switch on it exhaustively.
 */
export const COURSE_ISSUES = [
  'title_required',
  'title_too_long',
  'instructor_required',
  'tagline_too_long',
  'description_too_long',
  'outcomes_too_many',
  'outcome_too_long',
  'hours_invalid',
  'level_invalid',
  'cover_invalid',
  'photo_invalid',
  'category_invalid',
  'category_exists',
  'category_in_use',
  'video_invalid',
  'video_in_use',
  'lesson_invalid',
  'material_invalid',
  'too_many_materials',
  'course_invalid',
  'url_invalid',
  'duration_invalid',
  'start_required',
  'video_not_ready',
  'order_stale',
  'status_invalid',
  'live_cancelled',
  'replay_too_early',
  'patch_empty',
  'lesson_locked',
  'lesson_sequence_locked',
] as const;
export type CourseIssue = (typeof COURSE_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.courses`. */
export const COURSE_ISSUE_SET: ReadonlySet<string> = new Set(COURSE_ISSUES);

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-403). */
export const COURSE_PERMISSIONS = {
  manage: 'courses.manage',
} as const;

/** D-413: the one publication state, on the course only. */
export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** A fixed optional enum (the prototype's `CourseLevel`); no admin-managed levels. */
export const COURSE_LEVELS = ['iniciante', 'intermediario', 'avancado'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/**
 * The course's field rules, ONE definition shared by the create body and the patch body (the
 * 08.2-05 rule), so a title that passes one passes the other. Defaults live on the create body
 * only: a patch that omits a key leaves that column alone.
 */
const courseTitleField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(COURSE_MAX_TITLE, 'title_too_long');
const courseTaglineField = z.string().trim().max(COURSE_MAX_TAGLINE, 'tagline_too_long');
const courseDescriptionField = z
  .string()
  .trim()
  .max(COURSE_MAX_DESCRIPTION, 'description_too_long');
const courseCategoryField = z.uuid('category_invalid').nullable();
const courseLevelField = z.enum(COURSE_LEVELS, 'level_invalid').nullable();
const courseCoverField = z.uuid('cover_invalid').nullable();
/** D-412: free text, no membership FK. */
const instructorNameField = z
  .string()
  .trim()
  .min(1, 'instructor_required')
  .max(COURSE_MAX_TITLE, 'title_too_long');
const instructorPhotoField = z.uuid('photo_invalid').nullable();
const outcomesField = z
  .array(z.string().trim().min(1).max(COURSE_MAX_OUTCOME, 'outcome_too_long'))
  .max(COURSE_MAX_OUTCOMES, 'outcomes_too_many');
const certificateHoursField = z
  .number()
  .int('hours_invalid')
  .min(0, 'hours_invalid')
  .max(COURSE_MAX_HOURS, 'hours_invalid')
  .nullable();

/**
 * `POST /v1/courses`. Carries no product link: since 08.4 (D-418) links are written only by the
 * product form (`courseIds` on the store's product routes). `.strict()`: an unknown key fails
 * loudly, so a stale client that still sends the old link key gets a 400 and nothing is written.
 */
export const courseInputSchema = z
  .object({
    title: courseTitleField,
    tagline: courseTaglineField.default(''),
    description: courseDescriptionField.default(''),
    categoryId: courseCategoryField.default(null),
    level: courseLevelField.default(null),
    coverAssetId: courseCoverField.default(null),
    instructorName: instructorNameField,
    instructorPhotoAssetId: instructorPhotoField.default(null),
    outcomes: outcomesField.default([]),
    certificateHours: certificateHoursField.default(null),
  })
  .strict();
export type CourseInput = z.infer<typeof courseInputSchema>;

/**
 * `PATCH /v1/courses/{courseId}` (plan 04): any subset of the create body's keys, at least one.
 * Built from the same field rules WITHOUT their defaults (a `.partial()` of the create body would
 * keep `tagline: ''`, `categoryId: null` and silently wipe them). Carries no product link: links
 * are written only by the product form (D-418); the strict object refuses the old link key with 400.
 */
export const coursePatchSchema = z
  .object({
    title: courseTitleField.optional(),
    tagline: courseTaglineField.optional(),
    description: courseDescriptionField.optional(),
    categoryId: courseCategoryField.optional(),
    level: courseLevelField.optional(),
    coverAssetId: courseCoverField.optional(),
    instructorName: instructorNameField.optional(),
    instructorPhotoAssetId: instructorPhotoField.optional(),
    outcomes: outcomesField.optional(),
    certificateHours: certificateHoursField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type CoursePatch = z.infer<typeof coursePatchSchema>;

/**
 * `PUT /v1/courses/{courseId}/status` (D-413, COURSE-03): idempotent, one verb for every direction.
 * `draft → published` (refused while a lesson's video is not ready), `published → draft`
 * (unpublish), `draft | published → archived`; out of `archived` is `409 status_invalid`. The
 * status the course already has answers the unchanged detail.
 */
export const courseStatusBodySchema = z.object({ status: z.enum(COURSE_STATUSES) }).strict();
export type CourseStatusBody = z.infer<typeof courseStatusBodySchema>;

/**
 * D-411 / COURSE-04: the per-tenant category list the admin manages — a name and an optional cover,
 * no icon. ONE field definition for create and patch (the course rule above). Names are unique per
 * tenant IGNORING CASE: the service compares `lower(trim(name))` and answers `409 category_exists`;
 * the partial unique index `course_categories_tenant_name_uq` on `lower(name)` is the arbiter under
 * a race (P13, P15). The cap is measured on the trimmed string in code points.
 */
const categoryNameField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(CATEGORY_MAX_NAME, 'title_too_long');
const categoryCoverField = z.uuid('cover_invalid').nullable();

/** `POST /v1/courses/categories`. */
export const categoryInputSchema = z
  .object({
    name: categoryNameField,
    coverAssetId: categoryCoverField.default(null),
  })
  .strict();
export type CategoryInput = z.infer<typeof categoryInputSchema>;

/** `PATCH /v1/courses/categories/{categoryId}`: any subset, at least one key (no defaults re-applied). */
export const categoryPatchSchema = z
  .object({
    name: categoryNameField.optional(),
    coverAssetId: categoryCoverField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;

/**
 * One category as the manager lists it. `courseCount` counts the tenant's NON-archived courses in
 * the category (the chip the hub shows); the in-use refusal on delete counts EVERY course, archived
 * ones included, so the two numbers may differ (P16).
 */
export const categorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    coverAssetId: z.uuid().nullable(),
    courseCount: z.number().int().min(0),
  })
  .strict();
export type Category = z.infer<typeof categorySchema>;

/** `GET /v1/courses/categories`: every category of the tenant, ordered `lower(name), id`. */
export const categoryListSchema = z.object({ items: z.array(categorySchema) }).strict();
export type CategoryList = z.infer<typeof categoryListSchema>;

/** One admin catalogue page (COURSE-02): 20 rows, at most 50 when a caller asks. */
export const COURSE_PAGE_SIZE = 20;
export const COURSE_MAX_PAGE_SIZE = 50;
/** The longest cursor the list will look at (the store's rule). */
export const COURSE_MAX_CURSOR_LENGTH = 512;

/**
 * The hub's chip filter (Claude's Discretion: newest first, a `draft | published | archived` chip).
 * `all` (the default) is the LIVE catalogue — drafts and published courses; `archived` is the
 * archive alone, so an archived course never mixes with the live list.
 */
export const COURSE_FILTERS = ['all', 'draft', 'published', 'archived'] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];

/**
 * `GET /v1/courses?filter=&cursor=&limit=`. `.strict()`: an unknown query key fails loudly. Every
 * bound is a 400, never a widened read: a bad `filter`, a `limit` outside `1..50`, a cursor longer
 * than 512 characters (a tampered cursor of the right length is refused by the service, T-08.3-19).
 */
export const courseListQuerySchema = z
  .object({
    filter: z.enum(COURSE_FILTERS).default('all'),
    cursor: z.string().max(COURSE_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(COURSE_MAX_PAGE_SIZE).default(COURSE_PAGE_SIZE),
  })
  .strict();
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;

/**
 * One course as the hub lists it (the UI-SPEC's contract: the row omits nothing it can count).
 * `moduleCount` and `lessonCount` count LIVE modules and the live lessons under them,
 * `durationSeconds` sums the ready videos, `hasUnreadyVideo` is true while any live lesson's video
 * is missing from the lane or not `ready` (the publish-blocked badge) — every one computed in the
 * same statement as the row, never estimated by the web.
 */
export const courseRowSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(COURSE_STATUSES),
    coverAssetId: z.uuid().nullable(),
    categoryName: z.string().nullable(),
    level: z.enum(COURSE_LEVELS).nullable(),
    moduleCount: z.number().int().min(0),
    lessonCount: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    hasUnreadyVideo: z.boolean(),
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type CourseRow = z.infer<typeof courseRowSchema>;

/** One page: keyset over `(created_at desc, id desc)`; `nextCursor` is non-null exactly when more rows exist. */
export const coursePageSchema = z
  .object({
    items: z.array(courseRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type CoursePage = z.infer<typeof coursePageSchema>;

/** The module's field rules, shared by create and patch. */
const moduleTitleField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(MODULE_MAX_TITLE, 'title_too_long');
const moduleSummaryField = z.string().trim().max(MODULE_MAX_SUMMARY, 'description_too_long');
/** D-406: "Exige concluir o módulo anterior" — modeled and editable now, enforced in the member phase. */
const requiresPreviousField = z.boolean();

/** `POST /v1/courses/{courseId}/modules`. The position is the next one; the body never carries it. */
export const moduleInputSchema = z
  .object({
    title: moduleTitleField,
    summary: moduleSummaryField.default(''),
    requiresPrevious: requiresPreviousField.default(false),
  })
  .strict();
export type ModuleInput = z.infer<typeof moduleInputSchema>;

export const modulePatchSchema = z
  .object({
    title: moduleTitleField.optional(),
    summary: moduleSummaryField.optional(),
    requiresPrevious: requiresPreviousField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type ModulePatch = z.infer<typeof modulePatchSchema>;

/** The most children one whole-order body may name (modules of a course, lessons of a module). */
export const COURSE_MAX_ORDER = 200;

/** Every id once, compared lower-cased: `z.uuid()` accepts upper-case hex and two spellings are one row. */
const uniqueIds = (ids: readonly string[]) =>
  new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

/**
 * The whole-order body (D-414, RESEARCH Pattern 4 — the communities `PUT /order` rule): `ids` is
 * the parent's EVERY live child exactly once, in the new order. `PUT` because the body replaces the
 * whole order and a repeat of it is a no-op. The service compares the SET with the parent's live
 * children under a lock and answers `409 { courses: 'order_stale' }` for any difference — one
 * missing, one extra, one unknown or another tenant's, one removed since the list was loaded — so
 * the answer never tells which (T-08.3-21). Three rules of the body itself:
 * - `.min(1)`: an empty order is malformed (P18), never "remove every child";
 * - duplicates are refused HERE as malformed input (400), not as a stale set: a list naming one
 *   child twice is not a permutation of anything, and reloading could never fix it. The message is
 *   deliberately NOT a `COURSE_ISSUES` code, so the route's `defaultHook` answers the plain `issues`
 *   list rather than inventing a `details.courses` for it (the communities rule);
 * - `.strict()`: an unknown key fails loudly.
 */
export const reorderIdsSchema = (max: number) =>
  z
    .object({
      ids: z
        .array(z.uuid())
        .min(1)
        .max(max)
        .refine(uniqueIds, { message: 'Cada item aparece uma vez só.' }),
    })
    .strict();

/** `PUT /v1/courses/{courseId}/modules/order`: the course's live modules, every one once. */
export const reorderModulesSchema = reorderIdsSchema(COURSE_MAX_ORDER);
export type ReorderModules = z.infer<typeof reorderModulesSchema>;

/** `PUT /v1/courses/modules/{moduleId}/lessons/order`: the module's live lessons, every one once. */
export const reorderLessonsSchema = reorderIdsSchema(COURSE_MAX_ORDER);
export type ReorderLessons = z.infer<typeof reorderLessonsSchema>;

/** The lesson's field rules, shared by create and patch. */
const lessonTitleField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(LESSON_MAX_TITLE, 'title_too_long');
const lessonDescriptionField = z
  .string()
  .trim()
  .max(LESSON_MAX_DESCRIPTION, 'description_too_long');
/** D-409: a `lesson`-purpose video asset of THIS tenant, in any status; null is a practice lesson. */
const lessonVideoField = z.uuid('video_invalid').nullable();
/** D-407: "Aula aberta" — a sample a non-buyer may watch on a product-gated course. */
const isFreeField = z.boolean();
/**
 * D-428 / COURSE-22: "Exige concluir a aula anterior" — the lesson opens only after the previous
 * live lesson in course order is complete. The server stores `false` whatever the body says on the
 * FIRST live lesson of the course (there is no previous lesson) and on a FREE lesson (A-UI-6: an
 * "Aula aberta" ignores the sequence, D-429), on create, on every update and after every reorder or
 * removal that changes which lesson is first (`normaliseFirstLesson`, RESEARCH Pitfall 3).
 */
const lessonRequiresPreviousField = z.boolean();

/** `POST /v1/courses/modules/{moduleId}/lessons`. The position is the next one in the module. */
export const lessonInputSchema = z
  .object({
    title: lessonTitleField,
    description: lessonDescriptionField.default(''),
    videoAssetId: lessonVideoField.default(null),
    isFree: isFreeField.default(false),
    requiresPrevious: lessonRequiresPreviousField.default(false),
  })
  .strict();
export type LessonInput = z.infer<typeof lessonInputSchema>;

export const lessonPatchSchema = z
  .object({
    title: lessonTitleField.optional(),
    description: lessonDescriptionField.optional(),
    videoAssetId: lessonVideoField.optional(),
    isFree: isFreeField.optional(),
    requiresPrevious: lessonRequiresPreviousField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type LessonPatch = z.infer<typeof lessonPatchSchema>;

/**
 * A lesson's video readiness, projected from `media_assets.status`: `none` (no video: a practice
 * lesson), `pending` / `processing` / `ready` as the asset says, and `failed` for a `failed` or
 * `rejected` asset or one the lane can no longer see (removed). `durationSeconds` is the asset's,
 * only when `ready`.
 */
export const LESSON_VIDEO_STATUSES = ['none', 'pending', 'processing', 'ready', 'failed'] as const;
export type LessonVideoStatus = (typeof LESSON_VIDEO_STATUSES)[number];

/**
 * One lesson as the curriculum editor lists it. `requiresPrevious` is the STORED rule (D-428): it is
 * never `true` on the first live lesson of the course nor on a free lesson.
 */
export const lessonViewSchema = z
  .object({
    id: z.uuid(),
    moduleId: z.uuid(),
    title: z.string(),
    description: z.string(),
    position: z.number().int().min(1),
    isFree: z.boolean(),
    requiresPrevious: z.boolean(),
    videoAssetId: z.uuid().nullable(),
    videoStatus: z.enum(LESSON_VIDEO_STATUSES),
    durationSeconds: z.number().int().min(0).nullable(),
  })
  .strict();
export type LessonView = z.infer<typeof lessonViewSchema>;

/** One module with its live lessons in order. `durationSeconds` sums the ready videos. */
export const moduleViewSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    summary: z.string(),
    position: z.number().int().min(1),
    requiresPrevious: z.boolean(),
    lessonCount: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    lessons: z.array(lessonViewSchema),
  })
  .strict();
export type ModuleView = z.infer<typeof moduleViewSchema>;

/** `PUT /v1/courses/{courseId}/modules/order` answers the course's live modules in the new order. */
export const moduleListSchema = z.object({ items: z.array(moduleViewSchema) }).strict();
export type ModuleList = z.infer<typeof moduleListSchema>;

/** `PUT /v1/courses/modules/{moduleId}/lessons/order` answers the module's live lessons in the new order. */
export const lessonListSchema = z.object({ items: z.array(lessonViewSchema) }).strict();
export type LessonList = z.infer<typeof lessonListSchema>;

/**
 * D-410 / COURSE-07: the kind label the materials list shows, derived from the asset's mime by the
 * pure `materialKind` below — never stored, never typed (P27). `other` is the fallback for a mime the
 * pipeline accepts that none of the four names (none today; the set is closed so the web can switch
 * on it exhaustively).
 */
export const MATERIAL_KINDS = ['pdf', 'sheet', 'slides', 'image', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/**
 * `materialKind('application/pdf')` is `pdf`; the two spreadsheet mimes are `sheet`; the two
 * presentation mimes are `slides`; any `image/*` is `image`; anything else is `other`. Exported for
 * the web's rows (P27) so the API and the UI derive ONE vocabulary from the mime.
 */
export function materialKind(mime: string): MaterialKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  const kind = attachmentKindFor(mime);
  return kind === 'sheet' || kind === 'slides' ? kind : 'other';
}

/**
 * One material of a lesson as the lesson detail lists it (D-410): the join row's id (the handle the
 * URL route takes), the `attachment` asset behind it, the asset's stored `filename` (the browser's
 * original name, UTF-8, as stored — P27), its `mime`, the derived `kind`, its `bytes`, and its 1..N
 * `position` in the order the admin sent (P28).
 */
export const materialSchema = z
  .object({
    id: z.uuid(),
    assetId: z.uuid(),
    filename: z.string(),
    mime: z.string(),
    kind: z.enum(MATERIAL_KINDS),
    bytes: z.number().int().min(0),
    position: z.number().int().min(1),
  })
  .strict();
export type Material = z.infer<typeof materialSchema>;

/**
 * `GET /v1/courses/lessons/{lessonId}` — the lesson form's reading (plan 09): the lesson view, its
 * materials by `position, id`, the module it sits in and the course it belongs to. `course.hasProducts`
 * tells the form whether "Aula aberta" (D-407) means anything: on a course no product opens, every
 * lesson is open already.
 */
export const lessonDetailSchema = lessonViewSchema
  .extend({
    materials: z.array(materialSchema),
    module: z.object({ id: z.uuid(), title: z.string(), position: z.number().int() }).strict(),
    course: z
      .object({
        id: z.uuid(),
        title: z.string(),
        status: z.enum(COURSE_STATUSES),
        hasProducts: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type LessonDetail = z.infer<typeof lessonDetailSchema>;

/**
 * `PUT /v1/courses/lessons/{lessonId}/materials` (D-410, COURSE-07): the lesson's WHOLE ordered set
 * of materials, replaced in one call — `assetIds` in the order the admin arranged them, at most 10
 * (`too_many_materials`), every one once (a duplicate is refused as malformed input, the reorder
 * rule — P25), each a READY `attachment` asset of this tenant (`material_invalid` for a wrong
 * purpose, kind or status; an unknown or another tenant's id is the bare 404). `[]` clears the set
 * (P26). A non-uuid is `material_invalid`. `.strict()`: an unknown key fails loudly.
 */
export const materialsBodySchema = z
  .object({
    assetIds: z
      .array(z.uuid('material_invalid'))
      .max(LESSON_MAX_MATERIALS, 'too_many_materials')
      .refine(uniqueIds, { message: 'Cada item aparece uma vez só.' }),
  })
  .strict();
export type MaterialsBody = z.infer<typeof materialsBodySchema>;

/** How long a material's signed URL lives (Claude's Discretion: ten minutes). */
export const MATERIAL_URL_TTL_SECONDS = 600;

/**
 * 200 answer of `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` (D-410, COURSE-07,
 * T-08.3-06).
 *
 * **The URL is a bearer capability minted PER REQUEST and MUST NEVER be cached, persisted, logged or
 * embedded in a cacheable payload.** It is valid at the Storage edge, outside our infrastructure,
 * for `MATERIAL_URL_TTL_SECONDS`: anything that stores one hands a gated material to whoever reads
 * that store. The route therefore answers `Cache-Control: no-store`, the value never reaches the
 * database, and the log line carries the material id and never the URL. `expiresAt` is ISO 8601 UTC.
 */
export const materialUrlSchema = z.object({ url: z.string(), expiresAt: z.string() }).strict();
export type MaterialUrl = z.infer<typeof materialUrlSchema>;

/** A product that opens the course, as the manager's read-only "Liberado pelos produtos" lists it. */
export const courseProductSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(['active', 'archived']),
  })
  .strict();
export type CourseProduct = z.infer<typeof courseProductSchema>;

/**
 * The manager's course detail: the course row, its category, the products that open it (newest
 * first; read from the store's link table and written only by the product form, D-418), its live
 * modules with their live lessons, and the derived aggregates — `moduleCount`,
 * `lessonCount`, `durationSeconds` (ready videos only), `hasUnreadyVideo` and `unreadyLessonIds`
 * (the lessons that block publishing, D-413). `publishedAt` is set on the first publish and kept
 * through an unpublish; `archivedAt` on archive. Timestamps are ISO 8601, UTC.
 */
export const courseDetailSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    category: z.object({ id: z.uuid(), name: z.string() }).strict().nullable(),
    level: z.enum(COURSE_LEVELS).nullable(),
    coverAssetId: z.uuid().nullable(),
    instructorName: z.string(),
    instructorPhotoAssetId: z.uuid().nullable(),
    outcomes: z.array(z.string()),
    certificateHours: z.number().int().min(0).nullable(),
    status: z.enum(COURSE_STATUSES),
    publishedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    products: z.array(courseProductSchema),
    modules: z.array(moduleViewSchema),
    moduleCount: z.number().int().min(0),
    lessonCount: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    hasUnreadyVideo: z.boolean(),
    unreadyLessonIds: z.array(z.uuid()),
  })
  .strict();
export type CourseDetail = z.infer<typeof courseDetailSchema>;

// ── Tracks (08.3-10, D-414, D-415, COURSE-10) ────────────────────────────────────────────────────

/**
 * D-415: a track is an ordered path over the tenant's PUBLISHED courses — a title, a subtitle, an
 * audience ("Para quem está começando"), a cover and the ordered course ids. It has NO lessons, NO
 * hours and NO certificate of its own (PR-11): it sums what its courses have. `active | archived`
 * is the only state; archive never deletes, and `archived → active` IS allowed (the communities
 * reactivate posture — D-413's no-way-back is about COURSES).
 */
export const TRACK_STATUSES = ['active', 'archived'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

/** The Trilhas tab's chips: `active` (the default) or `archived`, never both. */
export const TRACK_FILTERS = ['active', 'archived'] as const;
export type TrackFilter = (typeof TRACK_FILTERS)[number];

/** The track's field rules, shared by the create body and the patch body (the course rule). */
const trackTitleField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(TRACK_MAX_TITLE, 'title_too_long');
const trackSubtitleField = z.string().trim().max(TRACK_MAX_SUBTITLE, 'tagline_too_long');
const trackAudienceField = z.string().trim().max(TRACK_MAX_AUDIENCE, 'tagline_too_long');
const trackDescriptionField = z.string().trim().max(TRACK_MAX_DESCRIPTION, 'description_too_long');
const trackCoverField = z.uuid('cover_invalid').nullable();

/** `POST /v1/courses/tracks`. The course list is NOT here: it travels by `PUT …/order` alone. */
export const trackInputSchema = z
  .object({
    title: trackTitleField,
    subtitle: trackSubtitleField.default(''),
    audience: trackAudienceField.default(''),
    description: trackDescriptionField.default(''),
    coverAssetId: trackCoverField.default(null),
  })
  .strict();
export type TrackInput = z.infer<typeof trackInputSchema>;

/** `PATCH /v1/courses/tracks/{trackId}`: any subset of the create body, at least one key, no defaults re-applied. */
export const trackPatchSchema = z
  .object({
    title: trackTitleField.optional(),
    subtitle: trackSubtitleField.optional(),
    audience: trackAudienceField.optional(),
    description: trackDescriptionField.optional(),
    coverAssetId: trackCoverField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type TrackPatch = z.infer<typeof trackPatchSchema>;

/** `PUT /v1/courses/tracks/{trackId}/status`: idempotent, both directions allowed (P42). */
export const trackStatusBodySchema = z.object({ status: z.enum(TRACK_STATUSES) }).strict();
export type TrackStatusBody = z.infer<typeof trackStatusBodySchema>;

/**
 * `GET /v1/courses/tracks?filter=&cursor=&limit=`: the courses list query with the two-value
 * filter; every bound is a 400, never a widened read (T-08.3-19).
 */
export const trackListQuerySchema = z
  .object({
    filter: z.enum(TRACK_FILTERS).default('active'),
    cursor: z.string().max(COURSE_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(COURSE_MAX_PAGE_SIZE).default(COURSE_PAGE_SIZE),
  })
  .strict();
export type TrackListQuery = z.infer<typeof trackListQuerySchema>;

/**
 * One track as the Trilhas tab lists it. `courseCount` counts ONLY the linked courses that are
 * `published` right now (UI-D-392, D-415: a course drops out at read time); the admin detail's
 * `courses` lists every link, so the two may differ (P41).
 */
export const trackRowSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
    status: z.enum(TRACK_STATUSES),
    courseCount: z.number().int().min(0),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type TrackRow = z.infer<typeof trackRowSchema>;

/** One page: keyset over `(created_at desc, id desc)`; `nextCursor` is non-null exactly when more rows exist. */
export const trackPageSchema = z
  .object({
    items: z.array(trackRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type TrackPage = z.infer<typeof trackPageSchema>;

/**
 * A linked course as the ADMIN detail lists it: every link row, with the course's CURRENT status, so
 * the form can mark a course that is no longer published ("Não publicado") and leave it out of the
 * next save (UI-D-402). The member read of the next phase filters `published` instead.
 */
export const trackCourseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(COURSE_STATUSES),
    coverAssetId: z.uuid().nullable(),
    position: z.number().int().min(1),
  })
  .strict();
export type TrackCourse = z.infer<typeof trackCourseSchema>;

/** The manager's track detail: the row, every linked course by `position, id`, and the published count. */
export const trackDetailSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    subtitle: z.string(),
    audience: z.string(),
    description: z.string(),
    coverAssetId: z.uuid().nullable(),
    status: z.enum(TRACK_STATUSES),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    courses: z.array(trackCourseSchema),
    courseCount: z.number().int().min(0),
  })
  .strict();
export type TrackDetail = z.infer<typeof trackDetailSchema>;

/**
 * `PUT /v1/courses/tracks/{trackId}/order` (D-414, D-415, COURSE-10, RESEARCH A8): the ONE write
 * path of a track's membership AND order. `ids` is the track's WHOLE course list in the new order:
 * a course absent from it is unlinked, one present but not yet linked is linked, positions become
 * 1..N. Three rules the reorder bodies share and one they do not:
 * - every id once (a duplicate is malformed input, 400 with the plain `issues` list — P39);
 * - at most `COURSE_MAX_ORDER`; `.strict()`;
 * - a non-uuid is `course_invalid` by name, the code the service also answers for a draft, an
 *   archived or another tenant's course (T-08.3-02);
 * - `[]` IS valid (P40): it clears the membership — unlike `reorderIdsSchema`, whose `.min(1)` says
 *   "every child once", because here the list is the membership itself.
 */
export const reorderTrackCoursesSchema = z
  .object({
    ids: z
      .array(z.uuid('course_invalid'))
      .max(COURSE_MAX_ORDER)
      .refine(uniqueIds, { message: 'Cada item aparece uma vez só.' }),
  })
  .strict();
export type ReorderTrackCourses = z.infer<typeof reorderTrackCoursesSchema>;

// ── Lives (08.3-11, D-416, COURSE-11) ────────────────────────────────────────────────────────────

/**
 * D-416: a live is an AGENDA ENTRY — a start, a planned duration, an external `https` link, an
 * optional product gate and, once it has happened, an optional replay pointing at a lesson of the
 * tenant. Nothing streams in the app and nobody is notified (PR-10). Its state is the CLOCK's answer
 * through ONE helper, `liveStatusAt`, shared by the API (projection) and the web (never recomputed
 * with the browser clock — the server passes the status with the page, UI-D-403): `scheduled` before
 * the start, `live` until `startsAt + durationMin`, `recorded` after. `cancelled_at` is the ONLY
 * stored state (`cancelled` wins over the clock); a cancel never deletes and the live keeps its time
 * bucket with the "Cancelada" pill.
 */
export const LIVE_STATUSES = ['scheduled', 'live', 'recorded', 'cancelled'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** The Lives tab's chips: `upcoming` (the default: every live whose END is still ahead) or `past`. */
export const LIVE_FILTERS = ['upcoming', 'past'] as const;
export type LiveFilter = (typeof LIVE_FILTERS)[number];

/** The longest `externalUrl` accepted (a YouTube or Meet link is far shorter; the E13 backstop types 200). */
export const LIVE_MAX_URL = 2048;

/** What `liveStatusAt` reads: the three columns that decide a live's state, as ISO strings or Dates. */
export interface LiveClockInput {
  startsAt: string | Date;
  durationMin: number;
  cancelledAt: string | Date | null;
}

/**
 * The prototype's `getLiveStatus` with the cancelled branch (RESEARCH Pattern 8): `cancelled` when
 * `cancelledAt` is set; else `scheduled` while `now < startsAt`; `live` while
 * `now < startsAt + durationMin` minutes; `recorded` from that instant on. Pure: `now` is a parameter,
 * so the API projects every row of one request against ONE instant and a test pins the six moments.
 * The boundaries are half-open: AT the start the live is `live`, AT the end it is `recorded`.
 */
export function liveStatusAt(live: LiveClockInput, now: Date): LiveStatus {
  if (live.cancelledAt !== null) return 'cancelled';
  const start = new Date(live.startsAt).getTime();
  const at = now.getTime();
  if (at < start) return 'scheduled';
  if (at < start + live.durationMin * 60_000) return 'live';
  return 'recorded';
}

/** The live's field rules, shared by the create body and the patch body (the course rule). */
const liveTitleField = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(LIVE_MAX_TITLE, 'title_too_long');
const liveDescriptionField = z.string().trim().max(LIVE_MAX_DESCRIPTION, 'description_too_long');
const liveCoverField = z.uuid('cover_invalid').nullable();
/**
 * An ISO 8601 instant WITH its offset (`2026-10-16T19:00:00-03:00` or `…T22:00:00Z`): the form
 * builds it from the date and time fields in the TENANT's timezone, the API stores the instant. A
 * missing, malformed or impossible (February 30th) value is `start_required`, the form's one error
 * for the pair. A start in the past is accepted (A-UI-5): the live simply reads "Gravada".
 */
const liveStartsAtField = z.iso
  .datetime({ offset: true, error: 'start_required' })
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'start_required' });
const liveDurationField = z
  .number()
  .int('duration_invalid')
  .min(LIVE_MIN_DURATION, 'duration_invalid')
  .max(LIVE_MAX_DURATION, 'duration_invalid');
/**
 * `https` ONLY (D-416, T-08.3-11): `http:`, `javascript:`, `ftp:` and a bare host are `url_invalid`
 * by name. Zod parses with the URL constructor, so a scheme-less or host-less string never reaches
 * the protocol check. The web renders it with `rel="noopener noreferrer"` in the member phase.
 */
const liveUrlField = z
  .url({ protocol: /^https$/, error: 'url_invalid' })
  .max(LIVE_MAX_URL, 'url_invalid');
/** `null` clears the replay; a uuid must be a LIVE lesson of this tenant (`lesson_invalid` otherwise). */
const liveReplayField = z.uuid('lesson_invalid').nullable();

/**
 * `POST /v1/courses/lives`. Carries no product link: since 08.4 (D-418) links are written only by
 * the product form (`liveIds` on the store's product routes); the strict object refuses the old link
 * key with 400. The replay never rides the create body: a live that has not happened has no
 * recording to point at (RESEARCH A5). `.strict()`.
 */
export const liveInputSchema = z
  .object({
    title: liveTitleField,
    description: liveDescriptionField.default(''),
    coverAssetId: liveCoverField.default(null),
    startsAt: liveStartsAtField,
    durationMin: liveDurationField,
    externalUrl: liveUrlField,
  })
  .strict();
export type LiveInput = z.infer<typeof liveInputSchema>;

/**
 * `PATCH /v1/courses/lives/{liveId}`: any subset of the create body WITHOUT defaults, plus
 * `replayLessonId` (nullable). At least one key. No product link (D-418: the product form writes it).
 * The service refuses the whole patch on a cancelled live (`409 live_cancelled`, A6) and a non-null
 * replay before the live has ended (`409 replay_too_early`, A5).
 */
export const livePatchSchema = z
  .object({
    title: liveTitleField.optional(),
    description: liveDescriptionField.optional(),
    coverAssetId: liveCoverField.optional(),
    startsAt: liveStartsAtField.optional(),
    durationMin: liveDurationField.optional(),
    externalUrl: liveUrlField.optional(),
    replayLessonId: liveReplayField.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'patch_empty',
  });
export type LivePatch = z.infer<typeof livePatchSchema>;

/**
 * `GET /v1/courses/lives?filter=&cursor=&limit=`: `upcoming` (the default) lists the lives whose
 * end is still ahead, soonest first; `past` the ended ones, latest first. Cancelled lives stay in
 * their time bucket (UI-D-391). Every bound is a 400, never a widened read (T-08.3-19).
 */
export const liveListQuerySchema = z
  .object({
    filter: z.enum(LIVE_FILTERS).default('upcoming'),
    cursor: z.string().max(COURSE_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(COURSE_MAX_PAGE_SIZE).default(COURSE_PAGE_SIZE),
  })
  .strict();
export type LiveListQuery = z.infer<typeof liveListQuerySchema>;

/** One live as the Lives tab lists it; `status` is the API's projection at answer time, never stored. */
export const liveRowSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    coverAssetId: z.uuid().nullable(),
    startsAt: z.iso.datetime(),
    durationMin: z.number().int(),
    status: z.enum(LIVE_STATUSES),
  })
  .strict();
export type LiveRow = z.infer<typeof liveRowSchema>;

/** One page: keyset over `(starts_at, id)` in the filter's direction; `nextCursor` non-null exactly when more rows exist. */
export const livePageSchema = z
  .object({
    items: z.array(liveRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type LivePage = z.infer<typeof livePageSchema>;

/** The replay as the detail names it: the lesson and the course it belongs to ("{course} · {lesson}"). */
export const liveReplaySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    courseTitle: z.string(),
  })
  .strict();
export type LiveReplay = z.infer<typeof liveReplaySchema>;

/**
 * The manager's live detail: the fields, the products that open it (store catalogue order, with
 * their `status`; written only by the product form, D-418), the replay lesson or null, and the DERIVED `status` (never a column, D-416).
 */
export const liveDetailSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    coverAssetId: z.uuid().nullable(),
    startsAt: z.iso.datetime(),
    durationMin: z.number().int(),
    externalUrl: z.string(),
    status: z.enum(LIVE_STATUSES),
    cancelledAt: z.iso.datetime().nullable(),
    products: z.array(courseProductSchema),
    replayLesson: liveReplaySchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type LiveDetail = z.infer<typeof liveDetailSchema>;

/**
 * `GET /v1/courses/lessons`: the tenant's LIVE lessons for the replay picker, grouped by course
 * order (course newest first, then module position, then lesson position; capped at 200). The host
 * groups the flat list by `courseId` into the sheet's sections (UI-D-403).
 */
export const lessonPickerItemSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    courseId: z.uuid(),
    courseTitle: z.string(),
    videoStatus: z.enum(LESSON_VIDEO_STATUSES),
  })
  .strict();
export type LessonPickerItem = z.infer<typeof lessonPickerItemSchema>;

export const lessonPickerListSchema = z.object({ items: z.array(lessonPickerItemSchema) }).strict();
export type LessonPickerList = z.infer<typeof lessonPickerListSchema>;

/** The most lessons the replay picker lists (a tenant with more needs the picker to search). */
export const LESSON_PICKER_MAX = 200;

// ── Member lane (08.5, D-423, D-426, D-428..D-430, COURSE-18..22) ───────────────────────────────

/**
 * Why a LESSON is locked for the caller, as the server's one evaluator (`app.course_lesson_states`)
 * decides it: `purchase` (a non-free lesson of a course no product the caller holds opens), `module`
 * (its module's "Exige concluir o módulo anterior" rule is unmet) or `lesson` (its own "Exige
 * concluir a aula anterior" rule is unmet). `null` is open. The web only LABELS these (UI-D-430); it
 * never decides a lock.
 */
export const LESSON_LOCK_REASONS = ['purchase', 'module', 'lesson'] as const;
export type LessonLockReason = (typeof LESSON_LOCK_REASONS)[number];

/** Why a MODULE reads locked in the curriculum: its rule is unmet, or the course is not bought. */
export const MODULE_LOCK_REASONS = ['purchase', 'module'] as const;
export type ModuleLockReason = (typeof MODULE_LOCK_REASONS)[number];

/**
 * One lesson of the member curriculum (D-423, EP-14): TITLES ONLY. A locked, non-free lesson
 * carries exactly these keys and never its description, video asset id, playback credential,
 * thumbnail or materials (PR-1). `number` is the 1-based rank among the live lessons of its module
 * (EP-15); `durationSeconds` is the ready video's integer seconds, null otherwise (EP-16);
 * `completedAt` and `lastPositionSeconds` are the CALLER's own progress row only (D-430).
 */
export const learnOutlineLessonSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    position: z.number().int(),
    number: z.number().int().min(1),
    durationSeconds: z.number().int().min(0).nullable(),
    hasVideo: z.boolean(),
    isFree: z.boolean(),
    requiresPrevious: z.boolean(),
    lockReason: z.enum(LESSON_LOCK_REASONS).nullable(),
    completedAt: z.iso.datetime().nullable(),
    lastPositionSeconds: z.number().int().min(0),
  })
  .strict();
export type LearnOutlineLesson = z.infer<typeof learnOutlineLessonSchema>;

/**
 * One module of the member curriculum: its live lessons in course order. `number` is the 1-based
 * rank among the live modules the curriculum shows (a soft-deleted or empty module leaves no gap,
 * EP-15). `lockReason` is `module` when any of its lessons is held by the module rule, else
 * `purchase` when the course is locked and any of its lessons is held by the purchase, else null.
 */
export const learnOutlineModuleSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    position: z.number().int(),
    number: z.number().int().min(1),
    requiresPrevious: z.boolean(),
    lockReason: z.enum(MODULE_LOCK_REASONS).nullable(),
    lessons: z.array(learnOutlineLessonSchema),
  })
  .strict();
export type LearnOutlineModule = z.infer<typeof learnOutlineModuleSchema>;

/**
 * D-430: the course page's progress summary, computed by the service from the outline. `total`
 * counts the live lessons (free ones included), `done` those with `completedAt`, `percent` is
 * `floor(done * 100 / total)` and 0 when `total` is 0 (EP-16). `nextLessonId` is the first lesson in
 * course order not completed and not locked ("Começar" / "Continuar"), null when none;
 * `firstLessonId` and `firstFreeLessonId` are the first live lesson and the first free one.
 */
export const learnProgressSchema = z
  .object({
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    percent: z.number().int().min(0).max(100),
    nextLessonId: z.uuid().nullable(),
    firstLessonId: z.uuid().nullable(),
    firstFreeLessonId: z.uuid().nullable(),
  })
  .strict();
export type LearnProgress = z.infer<typeof learnProgressSchema>;

/**
 * `GET /v1/courses/learn/courses/{courseId}` (08.5, SC 2): a PUBLISHED course (D-426, every role)
 * as the member's course page reads it — the header, `locked` (the course is product-gated for the
 * caller), the titles-only curriculum and the progress summary.
 */
export const learnCourseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    coverAssetId: z.uuid().nullable(),
    category: z.object({ id: z.uuid(), name: z.string() }).strict().nullable(),
    level: z.enum(COURSE_LEVELS).nullable(),
    instructorName: z.string(),
    instructorPhotoAssetId: z.uuid().nullable(),
    outcomes: z.array(z.string()),
    certificateHours: z.number().int().min(0).nullable(),
    locked: z.boolean(),
    modules: z.array(learnOutlineModuleSchema),
    progress: learnProgressSchema,
  })
  .strict();
export type LearnCourse = z.infer<typeof learnCourseSchema>;

/**
 * One material of an OPEN lesson as the member's player lists it: the join row's id (the handle the
 * signed-URL route takes), the stored filename, the derived kind, the mime and the bytes. Never the
 * asset id: the member opens a material through its signed URL route (plan 03), not by asset.
 */
export const learnMaterialSchema = z
  .object({
    id: z.uuid(),
    filename: z.string(),
    kind: z.enum(MATERIAL_KINDS),
    mime: z.string(),
    bytes: z.number().int().min(0),
  })
  .strict();
export type LearnMaterial = z.infer<typeof learnMaterialSchema>;

/** The previous or next lesson in course order, with its lock reason for the caller. */
export const learnNeighbourSchema = z
  .object({
    id: z.uuid(),
    lockReason: z.enum(LESSON_LOCK_REASONS).nullable(),
  })
  .strict();
export type LearnNeighbour = z.infer<typeof learnNeighbourSchema>;

/**
 * `GET /v1/courses/learn/lessons/{lessonId}` (08.5, SC 3): an OPEN lesson as the member's player
 * reads it — the content, its materials, the caller's own progress, the module's curriculum and the
 * neighbours in course order. A lesson the caller cannot open never reaches this shape: it is the
 * bare 404 (`missing`), `403 lesson_locked` or `409 lesson_sequence_locked`.
 */
export const learnLessonSchema = z
  .object({
    id: z.uuid(),
    courseId: z.uuid(),
    courseTitle: z.string(),
    coverAssetId: z.uuid().nullable(),
    instructorName: z.string(),
    instructorPhotoAssetId: z.uuid().nullable(),
    moduleId: z.uuid(),
    moduleTitle: z.string(),
    moduleNumber: z.number().int().min(1),
    lessonNumber: z.number().int().min(1),
    title: z.string(),
    description: z.string(),
    isFree: z.boolean(),
    videoAssetId: z.uuid().nullable(),
    videoStatus: z.enum(LESSON_VIDEO_STATUSES),
    durationSeconds: z.number().int().min(0).nullable(),
    materials: z.array(learnMaterialSchema),
    progress: z
      .object({
        completedAt: z.iso.datetime().nullable(),
        lastPositionSeconds: z.number().int().min(0),
      })
      .strict(),
    moduleLessons: z.array(learnOutlineLessonSchema),
    moduleProgress: z
      .object({ done: z.number().int().min(0), total: z.number().int().min(0) })
      .strict(),
    previous: learnNeighbourSchema.nullable(),
    next: learnNeighbourSchema.nullable(),
  })
  .strict();
export type LearnLesson = z.infer<typeof learnLessonSchema>;
