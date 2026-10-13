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
/** The most products one course (or one live) may be opened by. */
export const COURSE_MAX_PRODUCTS = 50;
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
 *    name (08.3-04, T-08.3-02); `category_invalid`, `product_invalid`, `lesson_invalid`,
 *    `course_invalid`: not a usable row of this tenant, or not a uuid; `video_invalid`: not a
 *    `lesson` video asset of this tenant — same by-name rule; `video_in_use`: already linked to a
 *    live lesson), `patch_empty`;
 *  - `409 CONFLICT`: `video_not_ready` (publishing while a lesson's video processes; `lessonIds`
 *    rides beside it), `status_invalid` (a transition out of `archived`), `category_exists`,
 *    `category_in_use`, `order_stale`, `live_cancelled`.
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
  'product_invalid',
  'too_many_products',
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
  'patch_empty',
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

/** A SET: duplicates collapse (first occurrence kept), after the cap is checked on what was sent. */
const dedupe = (ids: string[]) => [...new Set(ids)];

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
const productIdsField = z
  .array(z.uuid('product_invalid'))
  .max(COURSE_MAX_PRODUCTS, 'too_many_products');

/**
 * `POST /v1/courses`. `productIds` is a SET: duplicates collapse (first occurrence kept), after
 * the cap is checked on what was sent (D-404: the course form is the ONE write path of a
 * course-to-product link). `.strict()`: an unknown key fails loudly.
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
    productIds: productIdsField.default([]).transform(dedupe),
  })
  .strict();
export type CourseInput = z.infer<typeof courseInputSchema>;

/**
 * `PATCH /v1/courses/{courseId}` (plan 04): any subset of the create body's keys, at least one.
 * Built from the same field rules WITHOUT their defaults (a `.partial()` of the create body would
 * keep `tagline: ''`, `categoryId: null`, `productIds: []` and silently wipe them). `productIds`,
 * when present, REPLACES the course's links (one write path, D-404).
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
    productIds: productIdsField.transform(dedupe).optional(),
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

/** `POST /v1/courses/modules/{moduleId}/lessons`. The position is the next one in the module. */
export const lessonInputSchema = z
  .object({
    title: lessonTitleField,
    description: lessonDescriptionField.default(''),
    videoAssetId: lessonVideoField.default(null),
    isFree: isFreeField.default(false),
  })
  .strict();
export type LessonInput = z.infer<typeof lessonInputSchema>;

export const lessonPatchSchema = z
  .object({
    title: lessonTitleField.optional(),
    description: lessonDescriptionField.optional(),
    videoAssetId: lessonVideoField.optional(),
    isFree: isFreeField.optional(),
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

/** One lesson as the curriculum editor lists it. */
export const lessonViewSchema = z
  .object({
    id: z.uuid(),
    moduleId: z.uuid(),
    title: z.string(),
    description: z.string(),
    position: z.number().int().min(1),
    isFree: z.boolean(),
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
 * first), its live modules with their live lessons, and the derived aggregates — `moduleCount`,
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
