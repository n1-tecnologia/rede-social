import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { assertTenantKey, mediaOriginalKey } from '@rede-social/core/server/media/keys';
import { signReadFor } from '@rede-social/core/server/media/storage';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { type SQL, sql } from 'drizzle-orm';
import type {
  Category,
  CategoryInput,
  CategoryList,
  CategoryPatch,
  CourseDetail,
  CourseInput,
  CourseLevel,
  CourseListQuery,
  CourseRow as CourseListRow,
  CoursePage,
  CoursePatch,
  CourseProduct,
  CourseStatus,
  CourseStatusBody,
  LessonDetail,
  LessonInput,
  LessonList,
  LessonPatch,
  LessonPickerList,
  LessonVideoStatus,
  LessonView,
  LiveDetail,
  LiveInput,
  LiveListQuery,
  LivePage,
  LivePatch,
  LiveRow,
  Material,
  MaterialsBody,
  MaterialUrl,
  ModuleInput,
  ModuleList,
  ModulePatch,
  ModuleView,
  ReorderLessons,
  ReorderModules,
  ReorderTrackCourses,
  TrackCourse,
  TrackDetail,
  TrackInput,
  TrackListQuery,
  TrackPage,
  TrackPatch,
  TrackRow,
  TrackStatus,
  TrackStatusBody,
} from '../contracts/index';
import {
  LESSON_PICKER_MAX,
  liveStatusAt,
  MATERIAL_URL_TTL_SECONDS,
  materialKind,
} from '../contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-courses');

/**
 * The courses service, 08.3-01's tracer slice: `createCourse`, `getCourse`, `createModule`,
 * `createLesson` and `setCourseStatus` (the publish guard, D-413). Every statement runs inside
 * `withTenantTx` in the caller's lane, so RLS is the structural guard and the admin claim is what
 * authorises every write (D-403). Log lines carry ids, counts and outcomes only, never a title, a
 * description or an instructor's name (the T-05-06 rule).
 *
 * The products that open a course are read from `public.store_products` by SQL inside this
 * module's own statements: the courses package imports nothing from the store package (MOD-02; the
 * hand FK in `*_courses_functions.sql` is the only structural tie).
 */

/** The ISO 8601 UTC shape every timestamp leaves the service in (the events/store precedent). */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/** A Postgres `uuid[]` literal from ids the contract already proved are uuids. */
const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

type AssetRow = { kind: string; purpose: string; status: string };

type CourseRow = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  category_id: string | null;
  category_name: string | null;
  level: string | null;
  cover_asset_id: string | null;
  instructor_name: string;
  instructor_photo_asset_id: string | null;
  outcomes: string[];
  certificate_hours: number | null;
  status: string;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
};

type ProductRow = { id: string; name: string; status: string };

type ModuleRow = {
  id: string;
  title: string;
  summary: string;
  position: number;
  requires_previous: boolean;
};

type LessonRow = {
  id: string;
  module_id: string;
  title: string;
  description: string;
  position: number;
  is_free: boolean;
  video_asset_id: string | null;
  video_status: string | null;
  duration_seconds: number | null;
};

/**
 * `media_assets.status` → the lesson's `videoStatus`: no asset is `none`; an asset the lane cannot
 * see (removed, or never this tenant's) and a `failed`/`rejected`/`deleted` one are `failed`.
 */
function videoStatusOf(assetId: string | null, status: string | null): LessonVideoStatus {
  if (assetId === null) return 'none';
  if (status === 'pending' || status === 'processing' || status === 'ready') return status;
  return 'failed';
}

function lessonView(row: LessonRow): LessonView {
  const videoStatus = videoStatusOf(row.video_asset_id, row.video_status);
  return {
    id: row.id,
    moduleId: row.module_id,
    title: row.title,
    description: row.description,
    position: row.position,
    isFree: row.is_free,
    videoAssetId: row.video_asset_id,
    videoStatus,
    durationSeconds: videoStatus === 'ready' ? (row.duration_seconds ?? 0) : null,
  };
}

function moduleView(row: ModuleRow, lessons: LessonView[]): ModuleView {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    position: row.position,
    requiresPrevious: row.requires_previous,
    lessonCount: lessons.length,
    durationSeconds: lessons.reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0),
    lessons,
  };
}

/**
 * A cover-type image (a course cover, a category cover or the instructor photo), resolved INSIDE
 * the writing transaction in the caller's lane. Anything that is not a ready `cover` image of THIS
 * tenant — a wrong purpose, kind or status, AND an unknown, removed or another tenant's id — is ONE
 * `400 { courses: issue }` (08.3-04, T-08.3-02): the body reference is refused BY NAME, the
 * `resolveLessonVideo` rule, so the isolation sweep can assert a cross-tenant cover is refused as
 * such and the answer never tells a foreign id from an unknown one. (The store's `image_invalid`
 * keeps the bare 404 for a miss; this module does not, deliberately.) A null id performs no lookup:
 * "no image" is a first-class value (D-69).
 */
async function resolveCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  assetId: string | null,
  issue: 'cover_invalid' | 'photo_invalid',
): Promise<void> {
  if (assetId === null) return;
  const rows = await tx.execute<AssetRow>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${assetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null`);
  const asset = rows[0];
  if (!(asset?.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready')) {
    throw new ApiError(400, 'VALIDATION_FAILED', { courses: issue });
  }
}

/**
 * Postgres' SQLSTATE and constraint name, walked out of whatever the driver wrapped the error in
 * (the communities `isSlugCollision` shape). `null` when the error is not a Postgres error.
 */
function pgViolation(error: unknown): { code: string; constraint: string } | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint_name === 'string' ? candidate.constraint_name : '',
      };
    }
    current = candidate.cause;
  }
  return null;
}

type CategoryRow = {
  id: string;
  name: string;
  cover_asset_id: string | null;
  course_count: number;
};

const categoryView = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  coverAssetId: row.cover_asset_id,
  courseCount: row.course_count,
});

/**
 * The category projection with its count in ONE statement: a lateral count of the tenant's
 * NON-archived courses in the category (P16: the hub's chip; the delete refusal counts every
 * status). The tenant predicate is repeated inside the lateral so the planner can use
 * `courses_tenant_status_created_idx` without trusting the join alone.
 */
const CATEGORY_SELECT = sql`
  select c.id, c.name, c.cover_asset_id, n.course_count
    from course_categories c
    left join lateral (
      select count(*)::int as course_count
        from courses x
       where x.tenant_id = c.tenant_id
         and x.category_id = c.id
         and x.status <> 'archived') n on true`;

/** `GET /v1/courses/categories` (D-411, COURSE-04): every category of the tenant, `lower(name), id`. */
export async function listCategories(ctx: RequestContext): Promise<CategoryList> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<CategoryRow>(sql`
      ${CATEGORY_SELECT}
       where c.tenant_id = ${ctx.tenantId}::uuid
       order by lower(c.name) asc, c.id asc`),
  );
  return { items: rows.map(categoryView) };
}

async function readCategory(tx: Tx, ctx: RequestContext, categoryId: string): Promise<Category> {
  const rows = await tx.execute<CategoryRow>(sql`
    ${CATEGORY_SELECT}
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.id = ${categoryId}::uuid`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return categoryView(row);
}

/**
 * The pre-read behind `409 category_exists` (P13, P15): another category of THIS tenant whose
 * `lower(name)` equals the trimmed candidate's. The unique index `course_categories_tenant_name_uq`
 * decides under a race; this read makes the 409 the normal path rather than an exception.
 */
async function categoryNameTaken(
  tx: Tx,
  ctx: RequestContext,
  name: string,
  excludeId: string | null,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from course_categories
     where tenant_id = ${ctx.tenantId}::uuid
       and lower(name) = lower(${name})
       and (${excludeId}::uuid is null or id <> ${excludeId}::uuid)
     limit 1`);
  return rows.length > 0;
}

/** Locks the category row of THIS tenant for the rest of the transaction; null when there is none. */
async function lockCategory(
  tx: Tx,
  ctx: RequestContext,
  categoryId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select id, name from course_categories
     where id = ${categoryId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       for update`);
  return rows[0] ?? null;
}

/** The unique index on `(tenant_id, lower(name))` fired: two admins raced the same name. */
const isCategoryCollision = (error: unknown): boolean => {
  const violation = pgViolation(error);
  return violation?.code === '23505' && violation.constraint === 'course_categories_tenant_name_uq';
};

/**
 * `POST /v1/courses/categories` (D-411): the cover is resolved (`cover_invalid`), the name is
 * checked ignoring case (`409 { courses: 'category_exists' }`), the row is inserted. A concurrent
 * insert of the same name loses on the unique index and answers the same 409.
 */
export async function createCategory(ctx: RequestContext, input: CategoryInput): Promise<Category> {
  let category: Category;
  try {
    category = await withTenantTx(ctx, async (tx) => {
      await resolveCoverAsset(tx, ctx, input.coverAssetId, 'cover_invalid');
      if (await categoryNameTaken(tx, ctx, input.name, null)) {
        throw new ApiError(409, 'CONFLICT', { courses: 'category_exists' });
      }
      const rows = await tx.execute<{ id: string }>(sql`
        insert into course_categories (tenant_id, name, cover_asset_id)
        values (${ctx.tenantId}::uuid, ${input.name}, ${input.coverAssetId}::uuid)
        returning id`);
      const row = rows[0];
      if (!row) throw new ApiError(500, 'INTERNAL');
      return readCategory(tx, ctx, row.id);
    });
  } catch (error) {
    if (isCategoryCollision(error)) {
      throw new ApiError(409, 'CONFLICT', { courses: 'category_exists' });
    }
    throw error;
  }

  log.info(
    {
      event: 'courses.category_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      categoryId: category.id,
    },
    'course category created',
  );
  return category;
}

/**
 * `PATCH /v1/courses/categories/{categoryId}`: the row is locked (an unknown or foreign id is ONE
 * bare 404), a new name is checked against the OTHER categories ignoring case (renaming a category
 * to its own name in another case is allowed), a cover is resolved, and only the present keys
 * change (`updated_at` always).
 */
export async function updateCategory(
  ctx: RequestContext,
  categoryId: string,
  patch: CategoryPatch,
): Promise<Category> {
  let category: Category | null;
  try {
    category = await withTenantTx(ctx, async (tx) => {
      if (!(await lockCategory(tx, ctx, categoryId))) return null;
      if (patch.name !== undefined && (await categoryNameTaken(tx, ctx, patch.name, categoryId))) {
        throw new ApiError(409, 'CONFLICT', { courses: 'category_exists' });
      }
      if (patch.coverAssetId !== undefined) {
        await resolveCoverAsset(tx, ctx, patch.coverAssetId, 'cover_invalid');
      }
      const sets = [sql`updated_at = now()`];
      if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
      if (patch.coverAssetId !== undefined) {
        sets.push(sql`cover_asset_id = ${patch.coverAssetId}::uuid`);
      }
      await tx.execute(sql`
        update course_categories
           set ${sql.join(sets, sql`, `)}
         where id = ${categoryId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid`);
      return readCategory(tx, ctx, categoryId);
    });
  } catch (error) {
    if (isCategoryCollision(error)) {
      throw new ApiError(409, 'CONFLICT', { courses: 'category_exists' });
    }
    throw error;
  }
  if (!category) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.category_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      categoryId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof CategoryPatch] !== undefined),
    },
    'course category updated',
  );
  return category;
}

/** Every course of the tenant in the category, archived ones INCLUDED (the in-use rule, P16). */
async function countCategoryCourses(
  tx: Tx,
  ctx: RequestContext,
  categoryId: string,
): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from courses
     where tenant_id = ${ctx.tenantId}::uuid
       and category_id = ${categoryId}::uuid`);
  return rows[0]?.n ?? 0;
}

/**
 * `DELETE /v1/courses/categories/{categoryId}` (Claude's Discretion: an empty category may be
 * removed, one with courses may not). The row is locked (unknown or foreign: ONE bare 404), every
 * course referencing it is counted — archived ones included, a course keeps its category for ever
 * (D-413) — and a non-zero count is `409 { courses: 'category_in_use', courseCount }`. The FK
 * `courses.category_id … on delete restrict` is the structural guard under a race: a 23503 answers
 * the same 409 with a fresh count.
 */
export async function deleteCategory(ctx: RequestContext, categoryId: string): Promise<void> {
  let found: boolean;
  try {
    found = await withTenantTx(ctx, async (tx) => {
      if (!(await lockCategory(tx, ctx, categoryId))) return false;
      const courseCount = await countCategoryCourses(tx, ctx, categoryId);
      if (courseCount > 0) {
        throw new ApiError(409, 'CONFLICT', { courses: 'category_in_use', courseCount });
      }
      await tx.execute(sql`
        delete from course_categories
         where id = ${categoryId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid`);
      return true;
    });
  } catch (error) {
    const violation = pgViolation(error);
    if (violation?.code === '23503' && violation.constraint.includes('category')) {
      // The race: a course took the category between the count and the delete. Count again in a
      // fresh transaction (the failed one is aborted) so the answer still carries a true number.
      const courseCount = await withTenantTx(ctx, (tx) =>
        countCategoryCourses(tx, ctx, categoryId),
      );
      throw new ApiError(409, 'CONFLICT', {
        courses: 'category_in_use',
        courseCount: Math.max(courseCount, 1),
      });
    }
    throw error;
  }
  if (!found) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.category_deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      categoryId,
    },
    'course category deleted',
  );
}

/** The category must be a row of THIS tenant; any miss is `400 category_invalid`. */
async function resolveCategory(
  tx: Tx,
  ctx: RequestContext,
  categoryId: string | null,
): Promise<void> {
  if (categoryId === null) return;
  const rows = await tx.execute<{ id: string }>(sql`
    select id from course_categories
     where id = ${categoryId}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
  if (rows.length === 0)
    throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'category_invalid' });
}

/**
 * Every linked product must be an ACTIVE product of THIS tenant (T-08.3-02), read under RLS in the
 * caller's lane by hand SQL against `public.store_products` (never through the store package). Any
 * miss (unknown, archived, another tenant's) is ONE `400 { courses: 'product_invalid' }`, so the
 * answer never tells a foreign id from an unknown one.
 */
async function resolveProducts(
  tx: Tx,
  ctx: RequestContext,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const rows = await tx.execute<{ found: number }>(sql`
    select count(*)::int as found
      from store_products p
     where p.tenant_id = ${ctx.tenantId}::uuid
       and p.id = any (${uuidArray(productIds)}::uuid[])
       and p.status = 'active'`);
  if ((rows[0]?.found ?? 0) !== productIds.length) {
    throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'product_invalid' });
  }
}

/**
 * A lesson's video (D-409): a `lesson`-purpose VIDEO asset of THIS tenant, in ANY status (readiness
 * is the publish guard's question, not the link's). Unknown and foreign ids answer `400
 * video_invalid` BY NAME — not a bare 404 — so the isolation sweep can assert a cross-tenant asset
 * id is refused as such. An asset already linked to a live lesson is `400 video_in_use` (P22).
 */
async function resolveLessonVideo(
  tx: Tx,
  ctx: RequestContext,
  assetId: string | null,
  /** The lesson being edited: its own current video is never "in use" by another lesson (P22). */
  excludeLessonId: string | null = null,
): Promise<{ status: string; durationSeconds: number | null } | null> {
  if (assetId === null) return null;
  const rows = await tx.execute<AssetRow & { duration_seconds: number | null }>(sql`
    select kind, purpose, status, duration_seconds
      from media_assets
     where id = ${assetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null`);
  const asset = rows[0];
  if (asset?.purpose !== 'lesson' || asset.kind !== 'video') {
    throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'video_invalid' });
  }
  const used = await tx.execute<{ id: string }>(sql`
    select id from course_lessons
     where tenant_id = ${ctx.tenantId}::uuid
       and video_asset_id = ${assetId}::uuid
       and deleted_at is null
       and (${excludeLessonId}::uuid is null or id <> ${excludeLessonId}::uuid)`);
  if (used.length > 0) throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'video_in_use' });
  return { status: asset.status, durationSeconds: asset.duration_seconds };
}

/**
 * The partial unique index `course_lessons_tenant_video_uq` fired: two admins raced the same asset
 * onto two live lessons. It is the arbiter under a race; the service answers the same `video_in_use`.
 */
const isVideoCollision = (error: unknown): boolean => {
  const violation = pgViolation(error);
  return violation?.code === '23505' && violation.constraint === 'course_lessons_tenant_video_uq';
};

/** The products that open a course, newest first, read by SQL from the store's table (MOD-02). */
async function linkedProducts(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
): Promise<CourseProduct[]> {
  const rows = await tx.execute<ProductRow>(sql`
    select p.id, p.name, p.status
      from course_products l
      join store_products p on p.id = l.product_id and p.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and l.course_id = ${courseId}::uuid
     order by p.created_at desc, p.id desc`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status as CourseProduct['status'],
  }));
}

/** The list order of modules and lessons (P19): `position`, then the older row, then the id. */
const LIST_ORDER = sql`position asc, created_at asc, id asc`;

/**
 * The live lessons of one course (or of one module), left-joined to `media_assets` in the caller's
 * lane for the video status and the duration, in list order. Two rows with the same position —
 * possible only through a hand write — resolve by the next keys (P19).
 */
async function readLessonRows(
  tx: Tx,
  ctx: RequestContext,
  scope: { courseId: string } | { moduleId: string },
): Promise<LessonRow[]> {
  const parent =
    'courseId' in scope
      ? sql`l.course_id = ${scope.courseId}::uuid`
      : sql`l.module_id = ${scope.moduleId}::uuid`;
  return tx.execute<LessonRow>(sql`
    select l.id, l.module_id, l.title, l.description, l.position, l.is_free, l.video_asset_id,
           a.status as video_status, a.duration_seconds
      from course_lessons l
      left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and ${parent}
       and l.deleted_at is null
     order by l.position asc, l.created_at asc, l.id asc`);
}

/**
 * The course's live modules (`deleted_at is null`, ordered `position, created_at, id`) with their
 * live lessons — the reading the detail, the module routes and the reorder answer share.
 */
async function readModulesOf(tx: Tx, ctx: RequestContext, courseId: string): Promise<ModuleView[]> {
  const moduleRows = await tx.execute<ModuleRow>(sql`
    select id, title, summary, position, requires_previous
      from course_modules
     where tenant_id = ${ctx.tenantId}::uuid
       and course_id = ${courseId}::uuid
       and deleted_at is null
     order by ${LIST_ORDER}`);
  const lessonRows = await readLessonRows(tx, ctx, { courseId });
  const lessonsByModule = new Map<string, LessonView[]>();
  for (const row of lessonRows) {
    const list = lessonsByModule.get(row.module_id) ?? [];
    list.push(lessonView(row));
    lessonsByModule.set(row.module_id, list);
  }
  return moduleRows.map((row) => moduleView(row, lessonsByModule.get(row.id) ?? []));
}

/**
 * The manager's detail in ONE query set: the course row with its category, its products, its live
 * modules (`deleted_at is null`, ordered `position, created_at, id`) and their live lessons
 * left-joined to `media_assets` for the video status and duration. `null` when no course of THIS
 * tenant has the id (the caller answers the bare 404).
 */
async function readDetail(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
): Promise<CourseDetail | null> {
  const courseRows = await tx.execute<CourseRow>(sql`
    select c.id, c.title, c.tagline, c.description, c.category_id, k.name as category_name,
           c.level, c.cover_asset_id, c.instructor_name, c.instructor_photo_asset_id, c.outcomes,
           c.certificate_hours, c.status,
           to_char(c.published_at at time zone 'utc', ${ISO_MICROSECONDS}) as published_at,
           to_char(c.archived_at at time zone 'utc', ${ISO_MICROSECONDS}) as archived_at,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at
      from courses c
      left join course_categories k on k.id = c.category_id and k.tenant_id = c.tenant_id
     where c.id = ${courseId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid`);
  const course = courseRows[0];
  if (!course) return null;

  const products = await linkedProducts(tx, ctx, course.id);
  const modules = await readModulesOf(tx, ctx, course.id);
  const lessons = modules.flatMap((module) => module.lessons);
  const unready = lessons.filter(
    (lesson) => lesson.videoAssetId !== null && lesson.videoStatus !== 'ready',
  );

  return {
    id: course.id,
    title: course.title,
    tagline: course.tagline,
    description: course.description,
    category:
      course.category_id && course.category_name !== null
        ? { id: course.category_id, name: course.category_name }
        : null,
    level: course.level as CourseLevel | null,
    coverAssetId: course.cover_asset_id,
    instructorName: course.instructor_name,
    instructorPhotoAssetId: course.instructor_photo_asset_id,
    outcomes: course.outcomes,
    certificateHours: course.certificate_hours,
    status: course.status as CourseStatus,
    publishedAt: course.published_at,
    archivedAt: course.archived_at,
    createdAt: course.created_at,
    products,
    modules,
    moduleCount: modules.length,
    lessonCount: lessons.length,
    durationSeconds: modules.reduce((sum, module) => sum + module.durationSeconds, 0),
    hasUnreadyVideo: unready.length > 0,
    unreadyLessonIds: unready.map((lesson) => lesson.id),
  };
}

/**
 * `POST /v1/courses` (COURSE-02, D-404, D-412): the course (`draft`) and its product links in ONE
 * transaction. The cover, the instructor photo, the category and every product are resolved in the
 * caller's lane first; the links are written by `unnest … on conflict do nothing`.
 */
export async function createCourse(ctx: RequestContext, input: CourseInput): Promise<CourseDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    await resolveCoverAsset(tx, ctx, input.coverAssetId, 'cover_invalid');
    await resolveCoverAsset(tx, ctx, input.instructorPhotoAssetId, 'photo_invalid');
    await resolveCategory(tx, ctx, input.categoryId);
    await resolveProducts(tx, ctx, input.productIds);

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into courses
             (tenant_id, created_by_user_id, title, tagline, description, category_id, level,
              cover_asset_id, instructor_name, instructor_photo_asset_id, outcomes, certificate_hours)
      values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${input.title}, ${input.tagline},
              ${input.description}, ${input.categoryId}::uuid, ${input.level},
              ${input.coverAssetId}::uuid, ${input.instructorName},
              ${input.instructorPhotoAssetId}::uuid,
              (select coalesce(array_agg(o.value order by o.ordinality), '{}'::text[])
                 from jsonb_array_elements_text(${JSON.stringify(input.outcomes)}::jsonb)
                      with ordinality as o(value, ordinality)),
              ${input.certificateHours}::int)
      returning id`);
    const course = inserted[0];
    if (!course) throw new ApiError(500, 'INTERNAL');

    if (input.productIds.length > 0) {
      await tx.execute(sql`
        insert into course_products (tenant_id, course_id, product_id)
        select ${ctx.tenantId}::uuid, ${course.id}::uuid, ids.id
          from unnest(${uuidArray(input.productIds)}::uuid[]) as ids(id)
        on conflict (tenant_id, course_id, product_id) do nothing`);
    }
    const detail = await readDetail(tx, ctx, course.id);
    if (!detail) throw new ApiError(500, 'INTERNAL');
    return detail;
  });

  log.info(
    {
      event: 'courses.course_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId: detail.id,
      productCount: detail.products.length,
    },
    'course created',
  );
  return detail;
}

/** `GET /v1/courses/{courseId}`: the manager's detail. An unknown or foreign id is ONE bare 404 (D-23). */
export async function getCourse(ctx: RequestContext, courseId: string): Promise<CourseDetail> {
  const detail = await withTenantTx(ctx, (tx) => readDetail(tx, ctx, courseId));
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

/** Locks the course row of THIS tenant for the rest of the transaction; null when there is none. */
async function lockCourse(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await tx.execute<{ id: string; status: string }>(sql`
    select id, status from courses
     where id = ${courseId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       for update`);
  return rows[0] ?? null;
}

/** An instant this service could have issued in a cursor (the store's `isCursorInstant` rule). */
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
function isCursorInstant(value: string): boolean {
  const match = CURSOR_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000) return false;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second
  );
}

/**
 * The list cursor (T-08.3-19). Absent is page 1. Present but not an envelope this service issued
 * (not base64url JSON, a wrong version, an `id` that is not a uuid, an `n` that is not a real
 * instant) is `400 VALIDATION_FAILED { issues: [cursor_invalid] }`: nothing from the string reaches
 * SQL unvalidated.
 */
function decodeListCursor(raw: string | undefined): { n: string; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const decoded = decodeCursor(raw);
  if (!decoded || !isCursorInstant(decoded.n)) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      issues: [{ path: 'cursor', message: 'cursor_invalid' }],
    });
  }
  return decoded;
}

type ListRow = {
  id: string;
  title: string;
  status: string;
  cover_asset_id: string | null;
  category_name: string | null;
  level: string | null;
  module_count: number;
  lesson_count: number;
  duration_seconds: number;
  has_unready_video: boolean;
  created_at: string;
  published_at: string | null;
};

const toListRow = (row: ListRow): CourseListRow => ({
  id: row.id,
  title: row.title,
  status: row.status as CourseStatus,
  coverAssetId: row.cover_asset_id,
  categoryName: row.category_name,
  level: row.level as CourseLevel | null,
  moduleCount: row.module_count,
  lessonCount: row.lesson_count,
  durationSeconds: row.duration_seconds,
  hasUnreadyVideo: row.has_unready_video,
  createdAt: row.created_at,
  publishedAt: row.published_at,
});

/**
 * `GET /v1/courses?filter=&cursor=&limit=` (COURSE-02, P06, P07, P09). ONE statement per page:
 * the course row, its category name, and a LATERAL aggregate over the course's live modules and
 * their live lessons left-joined to `media_assets` in the caller's lane — `moduleCount`,
 * `lessonCount`, `durationSeconds` (ready videos), `hasUnreadyVideo` (a live lesson whose video is
 * missing from the lane or not `ready`), the same reading `readDetail` and the publish guard use.
 * Keyset over `(created_at desc, id desc)` (`courses_tenant_created_idx`,
 * `courses_tenant_status_created_idx`), over-fetch by one so `nextCursor` is non-null exactly when
 * another row exists, the id tiebreaker keeping two same-instant rows in a stable order across a
 * page boundary. `all` is drafts and published courses; each other filter is one status. The
 * filter is a Zod enum of four literals, bound as a parameter.
 */
export async function listCourses(
  ctx: RequestContext,
  query: CourseListQuery,
): Promise<CoursePage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const statusPredicate =
    query.filter === 'all'
      ? sql`c.status in ('draft', 'published')`
      : sql`c.status = ${query.filter}`;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<ListRow>(sql`
      select c.id, c.title, c.status, c.cover_asset_id, k.name as category_name, c.level,
             agg.module_count, agg.lesson_count, agg.duration_seconds, agg.has_unready_video,
             to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             to_char(c.published_at at time zone 'utc', ${ISO_MICROSECONDS}) as published_at
        from courses c
        left join course_categories k on k.id = c.category_id and k.tenant_id = c.tenant_id
        left join lateral (
          select count(distinct m.id)::int as module_count,
                 count(l.id)::int as lesson_count,
                 coalesce(sum(case when a.status = 'ready' then a.duration_seconds else 0 end), 0)::int
                   as duration_seconds,
                 coalesce(bool_or(l.video_asset_id is not null
                                  and (a.id is null or a.status <> 'ready')), false)
                   as has_unready_video
            from course_modules m
            left join course_lessons l
              on l.module_id = m.id and l.tenant_id = m.tenant_id and l.deleted_at is null
            left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
           where m.tenant_id = c.tenant_id
             and m.course_id = c.id
             and m.deleted_at is null) agg on true
       where c.tenant_id = ${ctx.tenantId}::uuid
         and ${statusPredicate}
         and (
           ${afterAt}::timestamptz is null
           or (c.created_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.created_at desc, c.id desc
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'courses.courses_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      filter: query.filter,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'courses listed',
  );
  return { items: page.map(toListRow), nextCursor };
}

/**
 * The ONE write path of a course-to-product link (D-404, STORE-03 posture): under the course row
 * lock, the whole set is replaced so the final set IS the sent set — every link NOT in the sent set
 * is deleted (an empty set deletes them all, P33), then the sent ids come in by `unnest … on
 * conflict do nothing`. Last writer wins with a whole set, never a union (P11, P36). Deleting only
 * the difference rather than everything is what keeps a re-sent identical set idempotent on the
 * ROWS too: their `created_at` survives (P35), and nothing is written for a link that already
 * exists.
 */
async function replaceCourseProducts(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
  productIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`
    delete from course_products
     where tenant_id = ${ctx.tenantId}::uuid
       and course_id = ${courseId}::uuid
       and product_id <> all (${uuidArray(productIds)}::uuid[])`);
  if (productIds.length === 0) return;
  await tx.execute(sql`
    insert into course_products (tenant_id, course_id, product_id)
    select ${ctx.tenantId}::uuid, ${courseId}::uuid, ids.id
      from unnest(${uuidArray(productIds)}::uuid[]) as ids(id)
    on conflict (tenant_id, course_id, product_id) do nothing`);
}

/**
 * `PATCH /v1/courses/{courseId}` (D-404, D-405, D-412, COURSE-02, COURSE-08, P10, P11). ONE
 * transaction: the course row is locked first (an unknown or foreign id is ONE bare 404), the
 * references present are resolved in the caller's lane (cover, photo, category, every product
 * ACTIVE and of this tenant), a dynamic `set` of only the keys present is applied (`updated_at`
 * always), and when `productIds` is present the link set is replaced. With the tenant's store off
 * the links still save and stay dormant (the gate answers nothing). Answers the manager's detail.
 */
export async function updateCourse(
  ctx: RequestContext,
  courseId: string,
  patch: CoursePatch,
): Promise<CourseDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    if (!(await lockCourse(tx, ctx, courseId))) return null;
    if (patch.coverAssetId !== undefined) {
      await resolveCoverAsset(tx, ctx, patch.coverAssetId, 'cover_invalid');
    }
    if (patch.instructorPhotoAssetId !== undefined) {
      await resolveCoverAsset(tx, ctx, patch.instructorPhotoAssetId, 'photo_invalid');
    }
    if (patch.categoryId !== undefined) await resolveCategory(tx, ctx, patch.categoryId);
    if (patch.productIds !== undefined) await resolveProducts(tx, ctx, patch.productIds);

    const sets = [sql`updated_at = now()`];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.tagline !== undefined) sets.push(sql`tagline = ${patch.tagline}`);
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
    if (patch.categoryId !== undefined) sets.push(sql`category_id = ${patch.categoryId}::uuid`);
    if (patch.level !== undefined) sets.push(sql`level = ${patch.level}`);
    if (patch.coverAssetId !== undefined) {
      sets.push(sql`cover_asset_id = ${patch.coverAssetId}::uuid`);
    }
    if (patch.instructorName !== undefined) {
      sets.push(sql`instructor_name = ${patch.instructorName}`);
    }
    if (patch.instructorPhotoAssetId !== undefined) {
      sets.push(sql`instructor_photo_asset_id = ${patch.instructorPhotoAssetId}::uuid`);
    }
    if (patch.outcomes !== undefined) {
      sets.push(sql`outcomes = (select coalesce(array_agg(o.value order by o.ordinality), '{}'::text[])
                                   from jsonb_array_elements_text(${JSON.stringify(patch.outcomes)}::jsonb)
                                        with ordinality as o(value, ordinality))`);
    }
    if (patch.certificateHours !== undefined) {
      sets.push(sql`certificate_hours = ${patch.certificateHours}::int`);
    }
    await tx.execute(sql`
      update courses
         set ${sql.join(sets, sql`, `)}
       where id = ${courseId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    if (patch.productIds !== undefined) {
      await replaceCourseProducts(tx, ctx, courseId, patch.productIds);
    }
    return readDetail(tx, ctx, courseId);
  });
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.course_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof CoursePatch] !== undefined),
      productCount: detail.products.length,
    },
    'course updated',
  );
  return detail;
}

/**
 * `POST /v1/courses/{courseId}/modules` (COURSE-04, D-406): the course row is locked, the module
 * takes the next position among the course's live modules, and the FIRST module never requires a
 * previous one (there is none; UI-D-396). An unknown or foreign course is ONE bare 404.
 */
export async function createModule(
  ctx: RequestContext,
  courseId: string,
  input: ModuleInput,
): Promise<ModuleView> {
  const view = await withTenantTx(ctx, async (tx) => {
    if (!(await lockCourse(tx, ctx, courseId))) return null;
    const rows = await tx.execute<ModuleRow>(sql`
      insert into course_modules (tenant_id, course_id, title, summary, position, requires_previous)
      select ${ctx.tenantId}::uuid, ${courseId}::uuid, ${input.title}, ${input.summary},
             next.position,
             case when next.position = 1 then false else ${input.requiresPrevious}::boolean end
        from (select coalesce(max(position), 0) + 1 as position
                from course_modules
               where tenant_id = ${ctx.tenantId}::uuid
                 and course_id = ${courseId}::uuid
                 and deleted_at is null) as next
      returning id, title, summary, position, requires_previous`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return moduleView(row, []);
  });
  if (!view) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.module_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId,
      moduleId: view.id,
      position: view.position,
    },
    'course module created',
  );
  return view;
}

type LockedModule = { id: string; course_id: string; position: number };

/**
 * Locks the LIVE module row of THIS tenant for the rest of the transaction; null when there is none
 * — unknown, another tenant's or removed are one answer (the caller's bare 404, D-23).
 */
async function lockModule(
  tx: Tx,
  ctx: RequestContext,
  moduleId: string,
): Promise<LockedModule | null> {
  const rows = await tx.execute<LockedModule>(sql`
    select id, course_id, position from course_modules
     where id = ${moduleId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
       for update`);
  return rows[0] ?? null;
}

/** The first live module of the course in list order (P19), or null for an empty course. */
async function firstModuleId(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from course_modules
     where tenant_id = ${ctx.tenantId}::uuid
       and course_id = ${courseId}::uuid
       and deleted_at is null
     order by ${LIST_ORDER}
     limit 1`);
  return rows[0]?.id ?? null;
}

/** One live module with its live lessons, or null (the caller's bare 404). */
async function readModule(
  tx: Tx,
  ctx: RequestContext,
  moduleId: string,
): Promise<ModuleView | null> {
  const rows = await tx.execute<ModuleRow>(sql`
    select id, title, summary, position, requires_previous
      from course_modules
     where id = ${moduleId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null`);
  const row = rows[0];
  if (!row) return null;
  const lessons = await readLessonRows(tx, ctx, { moduleId });
  return moduleView(row, lessons.map(lessonView));
}

/**
 * `PATCH /v1/courses/modules/{moduleId}` (COURSE-05, D-406, D-414): the live module row is locked
 * (unknown, foreign or removed: ONE bare 404), a dynamic `set` of the present keys is applied
 * (`updated_at` always). `requiresPrevious` is FORCED to `false` on the first live module of its
 * course (UI-D-396): there is no previous module to complete, so the answer carries the forced value
 * and the editor reads it back as off. Answers the module view with its live lessons.
 */
export async function updateModule(
  ctx: RequestContext,
  moduleId: string,
  patch: ModulePatch,
): Promise<ModuleView> {
  const view = await withTenantTx(ctx, async (tx) => {
    const module = await lockModule(tx, ctx, moduleId);
    if (!module) return null;
    const sets = [sql`updated_at = now()`];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.summary !== undefined) sets.push(sql`summary = ${patch.summary}`);
    if (patch.requiresPrevious !== undefined) {
      const isFirst = (await firstModuleId(tx, ctx, module.course_id)) === module.id;
      sets.push(sql`requires_previous = ${isFirst ? false : patch.requiresPrevious}::boolean`);
    }
    await tx.execute(sql`
      update course_modules
         set ${sql.join(sets, sql`, `)}
       where id = ${moduleId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return readModule(tx, ctx, moduleId);
  });
  if (!view) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.module_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      moduleId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof ModulePatch] !== undefined),
    },
    'course module updated',
  );
  return view;
}

/**
 * `DELETE /v1/courses/modules/{moduleId}` (COURSE-05, D-408 discretion): a SOFT delete — the live
 * row is locked and `deleted_at` is set; a second call finds no live row and is the bare 404. The
 * module's lessons keep their own rows (their `deleted_at` stays null — they leave every list
 * because the module is gone and the member reads join through the module) and every progress row
 * stays: nothing a member recorded is erased by an admin's "Remover" (PR-5). The remaining modules
 * keep their relative order with a gap in `position` until the next reorder renumbers them (P17).
 */
export async function deleteModule(ctx: RequestContext, moduleId: string): Promise<void> {
  const found = await withTenantTx(ctx, async (tx) => {
    const module = await lockModule(tx, ctx, moduleId);
    if (!module) return false;
    await tx.execute(sql`
      update course_modules
         set deleted_at = now(), updated_at = now()
       where id = ${moduleId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return true;
  });
  if (!found) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.module_deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      moduleId,
    },
    'course module removed',
  );
}

/**
 * The whole-order replace of ONE parent's live children (D-414, RESEARCH Pattern 4 — the
 * `reorderCommunities` statement, scoped by `parent`). The parent row is already locked by the
 * caller. In order: the live children are locked `for update` (ordered by id, so two concurrent
 * replaces take the same locks in the same order and serialise instead of deadlocking); the SET
 * is compared with the ids sent — any difference is `409 { courses: 'order_stale' }`, one answer for
 * a missing, an extra, an unknown, a foreign or a removed id (T-08.3-21); then ONE
 * `update … from unnest(...) with ordinality` writes positions 1..N in the order sent and touches
 * only the rows whose position really changes (`position <> o.ord`), so the same permutation twice
 * writes zero rows the second time (P20). Answers the number of rows written.
 *
 * The ids travel as ONE Postgres array literal: every element is a Zod-validated uuid AND a member
 * of the set just locked, so nothing caller-shaped reaches the literal.
 */
async function replaceOrder(
  tx: Tx,
  ctx: RequestContext,
  table: 'course_modules' | 'course_lessons',
  parent: SQL,
  ids: readonly string[],
): Promise<number> {
  const requested = ids.map((id) => id.toLowerCase());
  if (new Set(requested).size !== requested.length) {
    throw new ApiError(400, 'VALIDATION_FAILED');
  }
  const relation = sql.raw(table);
  const locked = await tx.execute<{ id: string }>(sql`
    select c.id
      from ${relation} c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and ${parent}
       and c.deleted_at is null
     order by c.id
     for update`);
  const current = new Set(locked.map((row) => row.id));
  if (requested.length !== current.size || requested.some((id) => !current.has(id))) {
    throw new ApiError(409, 'CONFLICT', { courses: 'order_stale' });
  }
  const renumbered = await tx.execute<{ id: string }>(sql`
    update ${relation} c
       set position = o.ord::int,
           updated_at = now()
      from unnest(${uuidArray(requested)}::uuid[]) with ordinality as o(id, ord)
     where c.id = o.id
       and c.tenant_id = ${ctx.tenantId}::uuid
       and ${parent}
       and c.deleted_at is null
       and c.position <> o.ord
    returning c.id`);
  return renumbered.length;
}

/**
 * `PUT /v1/courses/{courseId}/modules/order` (COURSE-05, D-414, P17-P21): the course row is locked
 * FIRST — an unknown or foreign course is the bare 404 before any set is read, so the 409 below
 * never doubles as an existence oracle — then `replaceOrder` over the course's live modules.
 * Answers the modules in the new order, with their lessons.
 */
export async function reorderModules(
  ctx: RequestContext,
  courseId: string,
  body: ReorderModules,
): Promise<ModuleList> {
  const result = await withTenantTx(ctx, async (tx) => {
    if (!(await lockCourse(tx, ctx, courseId))) return null;
    const moved = await replaceOrder(
      tx,
      ctx,
      'course_modules',
      sql`c.course_id = ${courseId}::uuid`,
      body.ids,
    );
    return { items: await readModulesOf(tx, ctx, courseId), moved };
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.modules_reordered',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId,
      // Counts only: neither the ids' order nor a title belongs in a log line (T-05-06).
      count: body.ids.length,
      moved: result.moved,
    },
    'course modules reordered',
  );
  return { items: result.items };
}

/**
 * `POST /v1/courses/modules/{moduleId}/lessons` (COURSE-06, D-407, D-409): the live module row is
 * locked (a removed, unknown or foreign module is ONE bare 404), the video is resolved, and the
 * lesson takes the next position in the module with `course_id` copied from the module (the gate
 * predicate reads it without a join).
 */
export async function createLesson(
  ctx: RequestContext,
  moduleId: string,
  input: LessonInput,
): Promise<LessonView> {
  let view: LessonView | null;
  try {
    view = await withTenantTx(ctx, async (tx) => {
      const module = await lockModule(tx, ctx, moduleId);
      if (!module) return null;
      const video = await resolveLessonVideo(tx, ctx, input.videoAssetId);
      const rows = await tx.execute<Omit<LessonRow, 'video_status' | 'duration_seconds'>>(sql`
        insert into course_lessons
               (tenant_id, course_id, module_id, title, description, video_asset_id, is_free, position)
        select ${ctx.tenantId}::uuid, ${module.course_id}::uuid, ${moduleId}::uuid, ${input.title},
               ${input.description}, ${input.videoAssetId}::uuid, ${input.isFree}::boolean,
               coalesce(max(position), 0) + 1
          from course_lessons
         where tenant_id = ${ctx.tenantId}::uuid
           and module_id = ${moduleId}::uuid
           and deleted_at is null
        returning id, module_id, title, description, position, is_free, video_asset_id`);
      const row = rows[0];
      if (!row) throw new ApiError(500, 'INTERNAL');
      return lessonView({
        ...row,
        video_status: video?.status ?? null,
        duration_seconds: video?.durationSeconds ?? null,
      });
    });
  } catch (error) {
    if (isVideoCollision(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'video_in_use' });
    }
    throw error;
  }
  if (!view) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.lesson_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      moduleId,
      lessonId: view.id,
      position: view.position,
      videoStatus: view.videoStatus,
    },
    'course lesson created',
  );
  return view;
}

type LockedLesson = {
  id: string;
  module_id: string;
  course_id: string;
  video_asset_id: string | null;
};

/**
 * Locks the LIVE lesson row of THIS tenant for the rest of the transaction; null when there is none
 * — unknown, another tenant's or removed are one answer (the caller's bare 404, D-23). The lesson's
 * OWN `deleted_at` is the predicate: a lesson under a removed module stays reachable by id for the
 * admin (to detach its video, say); it is absent from every list because the module is.
 */
async function lockLesson(
  tx: Tx,
  ctx: RequestContext,
  lessonId: string,
): Promise<LockedLesson | null> {
  const rows = await tx.execute<LockedLesson>(sql`
    select id, module_id, course_id, video_asset_id from course_lessons
     where id = ${lessonId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
       for update`);
  return rows[0] ?? null;
}

type MaterialRow = {
  id: string;
  asset_id: string;
  filename: string;
  mime: string;
  bytes: number;
  position: number;
};

const materialView = (row: MaterialRow): Material => ({
  id: row.id,
  assetId: row.asset_id,
  filename: row.filename,
  mime: row.mime,
  kind: materialKind(row.mime),
  bytes: row.bytes,
  position: row.position,
});

/**
 * The lesson's materials by `position, id` (P28), joined to `media_assets` in the caller's lane for
 * the stored `filename`, `mime` and `bytes` (P27: the filename as stored, no truncation). A material
 * whose asset the lane can no longer see (removed) drops out of the list, the lesson-video rule.
 */
async function readMaterials(tx: Tx, ctx: RequestContext, lessonId: string): Promise<Material[]> {
  const rows = await tx.execute<MaterialRow>(sql`
    select m.id, m.asset_id, a.filename, a.mime, a.bytes::int as bytes, m.position
      from course_lesson_materials m
      join media_assets a on a.id = m.asset_id and a.tenant_id = m.tenant_id
     where m.tenant_id = ${ctx.tenantId}::uuid
       and m.lesson_id = ${lessonId}::uuid
     order by m.position asc, m.id asc`);
  return rows.map(materialView);
}

type LessonDetailRow = LessonRow & {
  module_title: string;
  module_position: number;
  course_id: string;
  course_title: string;
  course_status: string;
  has_products: boolean;
};

/**
 * `GET /v1/courses/lessons/{lessonId}`'s reading: the live lesson joined to its asset (video status
 * and duration from the row, never from a body), its module, its course (`hasProducts`: a
 * `course_products` row exists — what "Aula aberta" is relative to, D-407) and its materials. `null`
 * when no live lesson of THIS tenant has the id (the caller answers the bare 404).
 */
async function readLessonDetail(
  tx: Tx,
  ctx: RequestContext,
  lessonId: string,
): Promise<LessonDetail | null> {
  const rows = await tx.execute<LessonDetailRow>(sql`
    select l.id, l.module_id, l.title, l.description, l.position, l.is_free, l.video_asset_id,
           a.status as video_status, a.duration_seconds,
           m.title as module_title, m.position as module_position,
           c.id as course_id, c.title as course_title, c.status as course_status,
           exists (select 1 from course_products p
                    where p.tenant_id = l.tenant_id and p.course_id = l.course_id) as has_products
      from course_lessons l
      join course_modules m on m.id = l.module_id and m.tenant_id = l.tenant_id
      join courses c on c.id = l.course_id and c.tenant_id = l.tenant_id
      left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
     where l.id = ${lessonId}::uuid
       and l.tenant_id = ${ctx.tenantId}::uuid
       and l.deleted_at is null`);
  const row = rows[0];
  if (!row) return null;
  return {
    ...lessonView(row),
    materials: await readMaterials(tx, ctx, lessonId),
    module: { id: row.module_id, title: row.module_title, position: row.module_position },
    course: {
      id: row.course_id,
      title: row.course_title,
      status: row.course_status as CourseStatus,
      hasProducts: row.has_products,
    },
  };
}

/** `GET /v1/courses/lessons/{lessonId}` (COURSE-06): the lesson detail. Unknown, foreign or removed: ONE bare 404. */
export async function getLesson(ctx: RequestContext, lessonId: string): Promise<LessonDetail> {
  const detail = await withTenantTx(ctx, (tx) => readLessonDetail(tx, ctx, lessonId));
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

/**
 * `PATCH /v1/courses/lessons/{lessonId}` (COURSE-06, D-407, D-409, P22): the live lesson row is
 * locked (unknown, foreign or removed: ONE bare 404); when `videoAssetId` is present, `null` detaches
 * the video and an id is resolved under the lane — a `lesson`-purpose video of THIS tenant in any
 * status, `400 video_invalid` by name otherwise; one already on ANOTHER live lesson is `400
 * video_in_use` (the lesson's own current video passes, so the same body twice leaves the row; the
 * partial unique index is the arbiter under a race and its 23505 answers the same code). A dynamic
 * `set` of the present keys is applied (`updated_at` always). `videoStatus` and `durationSeconds`
 * always come from the asset row — the contract has no field to type them (D-409, PR-6).
 */
export async function updateLesson(
  ctx: RequestContext,
  lessonId: string,
  patch: LessonPatch,
): Promise<LessonDetail> {
  let detail: LessonDetail | null;
  try {
    detail = await withTenantTx(ctx, async (tx) => {
      const lesson = await lockLesson(tx, ctx, lessonId);
      if (!lesson) return null;
      if (patch.videoAssetId !== undefined) {
        await resolveLessonVideo(tx, ctx, patch.videoAssetId, lessonId);
      }
      const sets = [sql`updated_at = now()`];
      if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
      if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
      if (patch.videoAssetId !== undefined) {
        sets.push(sql`video_asset_id = ${patch.videoAssetId}::uuid`);
      }
      if (patch.isFree !== undefined) sets.push(sql`is_free = ${patch.isFree}::boolean`);
      await tx.execute(sql`
        update course_lessons
           set ${sql.join(sets, sql`, `)}
         where id = ${lessonId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid`);
      return readLessonDetail(tx, ctx, lessonId);
    });
  } catch (error) {
    if (isVideoCollision(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'video_in_use' });
    }
    throw error;
  }
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.lesson_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof LessonPatch] !== undefined),
      videoStatus: detail.videoStatus,
    },
    'course lesson updated',
  );
  return detail;
}

/**
 * `DELETE /v1/courses/lessons/{lessonId}` (COURSE-06, D-408 discretion, PR-5): a SOFT delete — the
 * live row is locked and `deleted_at` is set; a second call is the bare 404. Every progress row stays
 * and the lesson's materials rows stay with it; the partial unique index frees the video asset for
 * another lesson (P22). The remaining lessons keep their order with a gap until the next reorder.
 */
export async function deleteLesson(ctx: RequestContext, lessonId: string): Promise<void> {
  const found = await withTenantTx(ctx, async (tx) => {
    const lesson = await lockLesson(tx, ctx, lessonId);
    if (!lesson) return false;
    await tx.execute(sql`
      update course_lessons
         set deleted_at = now(), updated_at = now()
       where id = ${lessonId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return true;
  });
  if (!found) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.lesson_deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
    },
    'course lesson removed',
  );
}

/**
 * `PUT /v1/courses/modules/{moduleId}/lessons/order` (COURSE-06, D-414): the live module row is
 * locked FIRST — unknown, foreign or removed is the bare 404 before any set is read — then
 * `replaceOrder` over the module's live lessons (a module with no live lesson and a non-empty body
 * is `order_stale`, P18). Answers the lessons in the new order.
 */
export async function reorderLessons(
  ctx: RequestContext,
  moduleId: string,
  body: ReorderLessons,
): Promise<LessonList> {
  const result = await withTenantTx(ctx, async (tx) => {
    if (!(await lockModule(tx, ctx, moduleId))) return null;
    const moved = await replaceOrder(
      tx,
      ctx,
      'course_lessons',
      sql`c.module_id = ${moduleId}::uuid`,
      body.ids,
    );
    const rows = await readLessonRows(tx, ctx, { moduleId });
    return { items: rows.map(lessonView), moved };
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.lessons_reordered',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      moduleId,
      count: body.ids.length,
      moved: result.moved,
    },
    'course lessons reordered',
  );
  return { items: result.items };
}

/**
 * `PUT /v1/courses/lessons/{lessonId}/materials` (D-410, COURSE-07, P24-P31): the live lesson row is
 * locked (unknown, foreign or removed: ONE bare 404 — and the lock is what serialises two concurrent
 * replaces, P31), then every id sent is resolved in ONE tenant-lane read of `media_assets`: a row the
 * lane cannot see (unknown, another tenant's, removed) is the bare 404; a row that is not a READY
 * `attachment` file — a cover image, a pending upload, a rejected one — is `400 material_invalid`.
 * Nothing is written on a refusal. Then the set is REPLACED so the final set IS the sent set: every
 * row NOT in the sent set is deleted (`[]` deletes them all, P26) and the sent ids come in by
 * `unnest … with ordinality` writing `position` 1..N in body order (P28), `on conflict … do update`
 * of the position only where it changed — so a re-sent identical set keeps its rows and their
 * `created_at` (P30), and the same asset may sit on two different lessons (the unique is per lesson,
 * P25). Answers the lesson detail.
 */
export async function replaceMaterials(
  ctx: RequestContext,
  lessonId: string,
  body: MaterialsBody,
): Promise<LessonDetail> {
  const ids = body.assetIds.map((id) => id.toLowerCase());
  const detail = await withTenantTx(ctx, async (tx) => {
    const lesson = await lockLesson(tx, ctx, lessonId);
    if (!lesson) return null;
    if (ids.length > 0) {
      const rows = await tx.execute<{ id: string } & AssetRow>(sql`
        select id, kind, purpose, status
          from media_assets
         where tenant_id = ${ctx.tenantId}::uuid
           and id = any (${uuidArray(ids)}::uuid[])
           and deleted_at is null`);
      if (rows.length !== ids.length) throw new ApiError(404, 'NOT_FOUND');
      const usable = (row: AssetRow) =>
        row.kind === 'file' && row.purpose === 'attachment' && row.status === 'ready';
      if (!rows.every(usable)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'material_invalid' });
      }
    }
    await tx.execute(sql`
      delete from course_lesson_materials
       where tenant_id = ${ctx.tenantId}::uuid
         and lesson_id = ${lessonId}::uuid
         and asset_id <> all (${uuidArray(ids)}::uuid[])`);
    if (ids.length > 0) {
      await tx.execute(sql`
        insert into course_lesson_materials (tenant_id, lesson_id, asset_id, position)
        select ${ctx.tenantId}::uuid, ${lessonId}::uuid, o.id, o.ord::int
          from unnest(${uuidArray(ids)}::uuid[]) with ordinality as o(id, ord)
        on conflict (tenant_id, lesson_id, asset_id)
        do update set position = excluded.position
        where course_lesson_materials.position <> excluded.position`);
    }
    return readLessonDetail(tx, ctx, lessonId);
  });
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.materials_replaced',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
      count: detail.materials.length,
    },
    'course lesson materials replaced',
  );
  return detail;
}

/**
 * `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` (D-410, COURSE-07, T-08.3-06): ONE
 * tenant-lane read of the material joined to its LIVE lesson and its asset — a material of another
 * lesson, of another tenant, of a removed lesson or of a removed asset, or an unknown id, is the bare
 * 404 (P26). The key is built from the CALLER's tenant id (`mediaOriginalKey`) and asserted under
 * that prefix (`assertTenantKey`) before Storage is asked, the media area's contract; then
 * `signReadFor(key, 600)` mints a fresh URL — no memo, so two calls are two URLs (P30) and a leaked
 * link dies within ten minutes. The URL is never logged: the line carries the material id only.
 */
export async function materialUrl(
  ctx: RequestContext,
  lessonId: string,
  materialId: string,
): Promise<MaterialUrl> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<{ asset_id: string }>(sql`
      select m.asset_id
        from course_lesson_materials m
        join course_lessons l
          on l.id = m.lesson_id and l.tenant_id = m.tenant_id and l.deleted_at is null
        join media_assets a
          on a.id = m.asset_id and a.tenant_id = m.tenant_id and a.deleted_at is null
       where m.tenant_id = ${ctx.tenantId}::uuid
         and m.lesson_id = ${lessonId}::uuid
         and m.id = ${materialId}::uuid`),
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');

  const key = mediaOriginalKey(ctx.tenantId, row.asset_id);
  assertTenantKey(key, ctx.tenantId);
  const url = await signReadFor(key, MATERIAL_URL_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + MATERIAL_URL_TTL_SECONDS * 1000).toISOString();

  log.info(
    {
      event: 'courses.material_url',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
      materialId,
      // The id only — never the URL (T-08.3-06).
      ttlSeconds: MATERIAL_URL_TTL_SECONDS,
    },
    'course material url minted',
  );
  return { url, expiresAt };
}

/**
 * `PUT /v1/courses/{courseId}/status` (COURSE-03, D-413, P23). ONE tenant transaction: the course
 * row is locked, then
 *  - the same status as the current one answers 200 with the unchanged detail and no `updated_at`
 *    bump (idempotent);
 *  - out of `archived` is `409 { courses: 'status_invalid' }` (archive never deletes and never
 *    reopens; a removed course stays a row);
 *  - publishing left-joins every live lesson that carries a video to `media_assets` INSIDE the
 *    transaction, after the lock; an asset that is missing from the lane or not `ready` blocks with
 *    `409 { courses: 'video_not_ready', lessonIds }` and nothing is written. A `ready` event racing
 *    the publish lands before the read (publish succeeds) or after it (409 now, the retry publishes);
 *  - `draft → published` sets `published_at` when null (kept through an unpublish);
 *    `published → draft` unpublishes; `draft | published → archived` sets `archived_at`.
 * An unknown or foreign id is ONE bare 404.
 */
export async function setCourseStatus(
  ctx: RequestContext,
  courseId: string,
  body: CourseStatusBody,
): Promise<CourseDetail> {
  const result = await withTenantTx(ctx, async (tx) => {
    const course = await lockCourse(tx, ctx, courseId);
    if (!course) return null;
    if (course.status === body.status) return readDetail(tx, ctx, courseId);
    if (course.status === 'archived') {
      throw new ApiError(409, 'CONFLICT', { courses: 'status_invalid' });
    }
    if (body.status === 'published') {
      const blocking = await tx.execute<{ id: string }>(sql`
        select l.id
          from course_lessons l
          left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
         where l.tenant_id = ${ctx.tenantId}::uuid
           and l.course_id = ${courseId}::uuid
           and l.deleted_at is null
           and l.video_asset_id is not null
           and (a.id is null or a.status <> 'ready')
         order by l.position asc, l.id asc`);
      if (blocking.length > 0) {
        throw new ApiError(409, 'CONFLICT', {
          courses: 'video_not_ready',
          lessonIds: blocking.map((row) => row.id),
        });
      }
    }
    await tx.execute(sql`
      update courses
         set status = ${body.status},
             published_at = case when ${body.status} = 'published'
                                 then coalesce(published_at, now()) else published_at end,
             archived_at = case when ${body.status} = 'archived' then now() else archived_at end,
             updated_at = now()
       where id = ${courseId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return readDetail(tx, ctx, courseId);
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.course_status',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId,
      status: body.status,
    },
    'course status set',
  );
  return result;
}

// ── Tracks (08.3-10, D-414, D-415, COURSE-10) ────────────────────────────────────────────────────

type TrackDbRow = {
  id: string;
  title: string;
  subtitle: string;
  audience: string;
  description: string;
  cover_asset_id: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
};

type TrackCourseRow = {
  id: string;
  title: string;
  status: string;
  cover_asset_id: string | null;
  position: number;
};

type TrackListDbRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  status: string;
  course_count: number;
  created_at: string;
};

const toTrackRow = (row: TrackListDbRow): TrackRow => ({
  id: row.id,
  title: row.title,
  coverAssetId: row.cover_asset_id,
  status: row.status as TrackStatus,
  courseCount: row.course_count,
  createdAt: row.created_at,
});

/**
 * The ADMIN's reading of a track's courses: EVERY link row, by `position, id`, with the course's
 * current status (P41). "Drops out at read time" (D-415) is the MEMBER read's filter in the next
 * phase; here the form needs to see a course that is no longer published so it can mark it and leave
 * it out of the next save (UI-D-402). The tenant predicate is repeated on both sides of the join.
 */
async function readTrackCourses(
  tx: Tx,
  ctx: RequestContext,
  trackId: string,
): Promise<TrackCourse[]> {
  const rows = await tx.execute<TrackCourseRow>(sql`
    select c.id, c.title, c.status, c.cover_asset_id, l.position
      from course_track_courses l
      join courses c on c.id = l.course_id and c.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and l.track_id = ${trackId}::uuid
     order by l.position asc, c.id asc`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as CourseStatus,
    coverAssetId: row.cover_asset_id,
    position: row.position,
  }));
}

/** The manager's track detail; `null` when no track of THIS tenant has the id (the caller's bare 404). */
async function readTrack(
  tx: Tx,
  ctx: RequestContext,
  trackId: string,
): Promise<TrackDetail | null> {
  const rows = await tx.execute<TrackDbRow>(sql`
    select t.id, t.title, t.subtitle, t.audience, t.description, t.cover_asset_id, t.status,
           to_char(t.archived_at at time zone 'utc', ${ISO_MICROSECONDS}) as archived_at,
           to_char(t.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at
      from course_tracks t
     where t.id = ${trackId}::uuid
       and t.tenant_id = ${ctx.tenantId}::uuid`);
  const track = rows[0];
  if (!track) return null;
  const courses = await readTrackCourses(tx, ctx, track.id);
  return {
    id: track.id,
    title: track.title,
    subtitle: track.subtitle,
    audience: track.audience,
    description: track.description,
    coverAssetId: track.cover_asset_id,
    status: track.status as TrackStatus,
    archivedAt: track.archived_at,
    createdAt: track.created_at,
    courses,
    // The row's count: published links only (UI-D-392), so the list and the detail agree (P41).
    courseCount: courses.filter((course) => course.status === 'published').length,
  };
}

/** Locks the track row of THIS tenant for the rest of the transaction; null when there is none. */
async function lockTrack(
  tx: Tx,
  ctx: RequestContext,
  trackId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await tx.execute<{ id: string; status: string }>(sql`
    select id, status from course_tracks
     where id = ${trackId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       for update`);
  return rows[0] ?? null;
}

/**
 * `GET /v1/courses/tracks?filter=&cursor=&limit=` (COURSE-10, UI-D-391/392): ONE statement per
 * page — the track row and a LATERAL count of its links whose course is `published` right now (the
 * row's "{N} cursos", D-415). Keyset over `(created_at desc, id desc)`
 * (`course_tracks_tenant_status_created_idx`), over-fetch by one, the courses list's cursor rule.
 */
export async function listTracks(ctx: RequestContext, query: TrackListQuery): Promise<TrackPage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<TrackListDbRow>(sql`
      select t.id, t.title, t.cover_asset_id, t.status, n.course_count,
             to_char(t.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at
        from course_tracks t
        left join lateral (
          select count(*)::int as course_count
            from course_track_courses l
            join courses c on c.id = l.course_id and c.tenant_id = l.tenant_id
           where l.tenant_id = t.tenant_id
             and l.track_id = t.id
             and c.status = 'published') n on true
       where t.tenant_id = ${ctx.tenantId}::uuid
         and t.status = ${query.filter}
         and (
           ${afterAt}::timestamptz is null
           or (t.created_at, t.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by t.created_at desc, t.id desc
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'courses.tracks_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      filter: query.filter,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'course tracks listed',
  );
  return { items: page.map(toTrackRow), nextCursor };
}

/** `POST /v1/courses/tracks` (COURSE-10, D-415): the `active` track with no course yet (P40); the cover resolved first. */
export async function createTrack(ctx: RequestContext, input: TrackInput): Promise<TrackDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    await resolveCoverAsset(tx, ctx, input.coverAssetId, 'cover_invalid');
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into course_tracks (tenant_id, title, subtitle, audience, description, cover_asset_id)
      values (${ctx.tenantId}::uuid, ${input.title}, ${input.subtitle}, ${input.audience},
              ${input.description}, ${input.coverAssetId}::uuid)
      returning id`);
    const track = inserted[0];
    if (!track) throw new ApiError(500, 'INTERNAL');
    const detail = await readTrack(tx, ctx, track.id);
    if (!detail) throw new ApiError(500, 'INTERNAL');
    return detail;
  });

  log.info(
    {
      event: 'courses.track_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      trackId: detail.id,
    },
    'course track created',
  );
  return detail;
}

/** `GET /v1/courses/tracks/{trackId}`: the admin detail. An unknown or foreign id is ONE bare 404 (D-23). */
export async function getTrack(ctx: RequestContext, trackId: string): Promise<TrackDetail> {
  const detail = await withTenantTx(ctx, (tx) => readTrack(tx, ctx, trackId));
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

/**
 * `PATCH /v1/courses/tracks/{trackId}`: the row is locked first (bare 404), a present cover is
 * resolved in the caller's lane, and a dynamic `set` of only the keys present is applied
 * (`updated_at` always). The course list never travels here (one write path, `PUT …/order`).
 */
export async function updateTrack(
  ctx: RequestContext,
  trackId: string,
  patch: TrackPatch,
): Promise<TrackDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    if (!(await lockTrack(tx, ctx, trackId))) return null;
    if (patch.coverAssetId !== undefined) {
      await resolveCoverAsset(tx, ctx, patch.coverAssetId, 'cover_invalid');
    }
    const sets = [sql`updated_at = now()`];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.subtitle !== undefined) sets.push(sql`subtitle = ${patch.subtitle}`);
    if (patch.audience !== undefined) sets.push(sql`audience = ${patch.audience}`);
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
    if (patch.coverAssetId !== undefined) {
      sets.push(sql`cover_asset_id = ${patch.coverAssetId}::uuid`);
    }
    await tx.execute(sql`
      update course_tracks
         set ${sql.join(sets, sql`, `)}
       where id = ${trackId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return readTrack(tx, ctx, trackId);
  });
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.track_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      trackId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof TrackPatch] !== undefined),
    },
    'course track updated',
  );
  return detail;
}

/**
 * `PUT /v1/courses/tracks/{trackId}/status` (D-415, P42): the one idempotent verb. `active →
 * archived` sets `archived_at`; `archived → active` clears it (allowed: the communities reactivate
 * posture — D-413's no-way-back is about COURSES). The status the track already has answers the
 * unchanged detail. Archive never deletes; the link rows stay.
 */
export async function setTrackStatus(
  ctx: RequestContext,
  trackId: string,
  body: TrackStatusBody,
): Promise<TrackDetail> {
  const result = await withTenantTx(ctx, async (tx) => {
    const track = await lockTrack(tx, ctx, trackId);
    if (!track) return null;
    if (track.status === body.status) return readTrack(tx, ctx, trackId);
    await tx.execute(sql`
      update course_tracks
         set status = ${body.status},
             archived_at = case when ${body.status} = 'archived' then now() else null end,
             updated_at = now()
       where id = ${trackId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    return readTrack(tx, ctx, trackId);
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.track_status',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      trackId,
      status: body.status,
    },
    'course track status set',
  );
  return result;
}

/**
 * `PUT /v1/courses/tracks/{trackId}/order` (D-414, D-415, COURSE-10, RESEARCH A8, P39-P43): the ONE
 * write path of a track's membership AND order. Under the track row lock (bare 404 first, so the 400
 * below is never an existence oracle):
 *  1. every id must be a `courses` row of THIS tenant with `status = 'published'` — a count compare,
 *     so a draft, an archived, an unknown and another tenant's id are ONE `400 course_invalid`
 *     (T-08.3-02; the same code the contract gives a non-uuid);
 *  2. the links NOT in the list are deleted (`[]` clears them all, P40);
 *  3. the ids come in by `unnest … with ordinality on conflict do nothing`, so a link that already
 *     exists keeps its row and its `created_at` (P42);
 *  4. ONE `update … from unnest(...) with ordinality` writes positions 1..N in the order sent and
 *     touches only the rows whose position really changes (the same list twice renumbers zero rows).
 * The lock serialises two concurrent lists: both answer 200 and the final membership is exactly one
 * of them (P43). A course may belong to several tracks (one row per track, P39). Answers the detail.
 */
export async function replaceTrackCourses(
  ctx: RequestContext,
  trackId: string,
  body: ReorderTrackCourses,
): Promise<TrackDetail> {
  const ids = body.ids.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'VALIDATION_FAILED');

  const result = await withTenantTx(ctx, async (tx) => {
    if (!(await lockTrack(tx, ctx, trackId))) return null;
    if (ids.length > 0) {
      const rows = await tx.execute<{ found: number }>(sql`
        select count(*)::int as found
          from courses c
         where c.tenant_id = ${ctx.tenantId}::uuid
           and c.id = any (${uuidArray(ids)}::uuid[])
           and c.status = 'published'`);
      if ((rows[0]?.found ?? 0) !== ids.length) {
        throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'course_invalid' });
      }
    }
    const removed = await tx.execute<{ course_id: string }>(sql`
      delete from course_track_courses
       where tenant_id = ${ctx.tenantId}::uuid
         and track_id = ${trackId}::uuid
         and course_id <> all (${uuidArray(ids)}::uuid[])
      returning course_id`);
    let added = 0;
    let moved = 0;
    if (ids.length > 0) {
      const inserted = await tx.execute<{ course_id: string }>(sql`
        insert into course_track_courses (tenant_id, track_id, course_id, position)
        select ${ctx.tenantId}::uuid, ${trackId}::uuid, o.id, o.ord::int
          from unnest(${uuidArray(ids)}::uuid[]) with ordinality as o(id, ord)
        on conflict (tenant_id, track_id, course_id) do nothing
        returning course_id`);
      added = inserted.length;
      const renumbered = await tx.execute<{ course_id: string }>(sql`
        update course_track_courses l
           set position = o.ord::int
          from unnest(${uuidArray(ids)}::uuid[]) with ordinality as o(id, ord)
         where l.tenant_id = ${ctx.tenantId}::uuid
           and l.track_id = ${trackId}::uuid
           and l.course_id = o.id
           and l.position <> o.ord
        returning l.course_id`);
      moved = renumbered.length;
    }
    // The same list twice writes nothing, the track row's `updated_at` included (P42).
    if (removed.length + added + moved > 0) {
      await tx.execute(sql`
        update course_tracks set updated_at = now()
         where id = ${trackId}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    }
    const detail = await readTrack(tx, ctx, trackId);
    return { detail, removed: removed.length, added, moved };
  });
  if (!result?.detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.track_courses_replaced',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      trackId,
      // Counts only: neither the ids' order nor a title belongs in a log line (T-05-06).
      count: ids.length,
      added: result.added,
      removed: result.removed,
      moved: result.moved,
    },
    'course track courses replaced',
  );
  return result.detail;
}

// ── Lives (08.3-11, D-416, COURSE-11) ────────────────────────────────────────────────────────────

type LiveDbRow = {
  id: string;
  title: string;
  description: string;
  cover_asset_id: string | null;
  starts_at: string;
  duration_min: number;
  external_url: string;
  cancelled_at: string | null;
  created_at: string;
  replay_lesson_id: string | null;
  replay_lesson_title: string | null;
  replay_course_title: string | null;
};

type LiveListDbRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  duration_min: number;
  cancelled_at: string | null;
};

type LockedLive = {
  id: string;
  starts_at: string;
  duration_min: number;
  cancelled_at: string | null;
};

/** The status of one row against ONE instant (D-416): the clock's answer, never a column. */
const liveStatusOf = (
  row: { starts_at: string; duration_min: number; cancelled_at: string | null },
  now: Date,
) =>
  liveStatusAt(
    { startsAt: row.starts_at, durationMin: row.duration_min, cancelledAt: row.cancelled_at },
    now,
  );

const toLiveRow = (row: LiveListDbRow, now: Date): LiveRow => ({
  id: row.id,
  title: row.title,
  coverAssetId: row.cover_asset_id,
  startsAt: row.starts_at,
  durationMin: row.duration_min,
  status: liveStatusOf(row, now),
});

/** The products that open a live, the course's reading over `course_live_products` (D-404). */
async function linkedLiveProducts(
  tx: Tx,
  ctx: RequestContext,
  liveId: string,
): Promise<CourseProduct[]> {
  const rows = await tx.execute<ProductRow>(sql`
    select p.id, p.name, p.status
      from course_live_products l
      join store_products p on p.id = l.product_id and p.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and l.live_id = ${liveId}::uuid
     order by p.created_at desc, p.id desc`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status as CourseProduct['status'],
  }));
}

/**
 * The manager's live detail; `null` when no live of THIS tenant has the id (the caller's bare 404).
 * The replay lesson is joined to its course for the form's "{course} · {lesson}"; the tenant
 * predicate is repeated on both joins. `status` is projected against `now` — the clock, not a column.
 */
async function readLive(
  tx: Tx,
  ctx: RequestContext,
  liveId: string,
  now: Date,
): Promise<LiveDetail | null> {
  const rows = await tx.execute<LiveDbRow>(sql`
    select v.id, v.title, v.description, v.cover_asset_id, v.duration_min, v.external_url,
           to_char(v.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           to_char(v.cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at,
           to_char(v.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           rl.id as replay_lesson_id, rl.title as replay_lesson_title, rc.title as replay_course_title
      from course_lives v
      left join course_lessons rl on rl.id = v.replay_lesson_id and rl.tenant_id = v.tenant_id
      left join courses rc on rc.id = rl.course_id and rc.tenant_id = rl.tenant_id
     where v.id = ${liveId}::uuid
       and v.tenant_id = ${ctx.tenantId}::uuid`);
  const live = rows[0];
  if (!live) return null;
  const products = await linkedLiveProducts(tx, ctx, live.id);
  return {
    id: live.id,
    title: live.title,
    description: live.description,
    coverAssetId: live.cover_asset_id,
    startsAt: live.starts_at,
    durationMin: live.duration_min,
    externalUrl: live.external_url,
    status: liveStatusOf(live, now),
    cancelledAt: live.cancelled_at,
    products,
    replayLesson:
      live.replay_lesson_id && live.replay_lesson_title !== null
        ? {
            id: live.replay_lesson_id,
            title: live.replay_lesson_title,
            courseTitle: live.replay_course_title ?? '',
          }
        : null,
    createdAt: live.created_at,
  };
}

/** Locks the live row of THIS tenant for the rest of the transaction; null when there is none. */
async function lockLive(tx: Tx, ctx: RequestContext, liveId: string): Promise<LockedLive | null> {
  const rows = await tx.execute<LockedLive>(sql`
    select id, duration_min,
           to_char(starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           to_char(cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at
      from course_lives
     where id = ${liveId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       for update`);
  return rows[0] ?? null;
}

/**
 * The ONE write path of a live-to-product link (D-404), `replaceCourseProducts` over
 * `course_live_products`: delete the links NOT in the sent set, insert the missing ones with
 * `on conflict do nothing`, so a re-sent identical set touches no row (P44) and the empty set clears.
 */
async function replaceLiveProducts(
  tx: Tx,
  ctx: RequestContext,
  liveId: string,
  productIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`
    delete from course_live_products
     where tenant_id = ${ctx.tenantId}::uuid
       and live_id = ${liveId}::uuid
       and product_id <> all (${uuidArray(productIds)}::uuid[])`);
  if (productIds.length === 0) return;
  await tx.execute(sql`
    insert into course_live_products (tenant_id, live_id, product_id)
    select ${ctx.tenantId}::uuid, ${liveId}::uuid, ids.id
      from unnest(${uuidArray(productIds)}::uuid[]) as ids(id)
    on conflict (tenant_id, live_id, product_id) do nothing`);
}

/**
 * `GET /v1/courses/lives?filter=&cursor=&limit=` (COURSE-11, UI-D-391/392): `upcoming` = the lives
 * whose END (`starts_at + duration_min`) is still ahead of the database clock, soonest first on a
 * keyset over `(starts_at asc, id asc)` (`course_lives_tenant_starts_idx`); `past` = the ended ones,
 * latest first (`desc, desc`). A cancelled live stays in its time bucket. Over-fetch by one, the
 * courses list's cursor rule (`n` is the row's `starts_at`). The status of every row is projected
 * against ONE `new Date()` taken per request.
 */
export async function listLives(ctx: RequestContext, query: LiveListQuery): Promise<LivePage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const upcoming = query.filter === 'upcoming';
  const bucket = upcoming
    ? sql`v.starts_at + make_interval(mins => v.duration_min) > now()`
    : sql`v.starts_at + make_interval(mins => v.duration_min) <= now()`;
  const keyset = upcoming
    ? sql`(v.starts_at, v.id) > (${afterAt}::timestamptz, ${afterId}::uuid)`
    : sql`(v.starts_at, v.id) < (${afterAt}::timestamptz, ${afterId}::uuid)`;
  const order = upcoming ? sql`v.starts_at asc, v.id asc` : sql`v.starts_at desc, v.id desc`;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<LiveListDbRow>(sql`
      select v.id, v.title, v.cover_asset_id, v.duration_min,
             to_char(v.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
             to_char(v.cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at
        from course_lives v
       where v.tenant_id = ${ctx.tenantId}::uuid
         and ${bucket}
         and (${afterAt}::timestamptz is null or ${keyset})
       order by ${order}
       limit ${limit + 1}`),
  );
  const now = new Date();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.starts_at, id: last.id }) : null;

  log.info(
    {
      event: 'courses.lives_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      filter: query.filter,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'course lives listed',
  );
  return { items: page.map((row) => toLiveRow(row, now)), nextCursor };
}

/**
 * `POST /v1/courses/lives` (COURSE-11, D-416): the cover and every product resolved in the caller's
 * lane first, the row inserted with its UTC instant, the links by `unnest`. A start in the past is
 * accepted (A-UI-5) — the live reads `recorded` at once. Answers the detail with its derived status.
 */
export async function createLive(ctx: RequestContext, input: LiveInput): Promise<LiveDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    await resolveCoverAsset(tx, ctx, input.coverAssetId, 'cover_invalid');
    await resolveProducts(tx, ctx, input.productIds);
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into course_lives
             (tenant_id, created_by_user_id, title, description, cover_asset_id, starts_at,
              duration_min, external_url)
      values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${input.title}, ${input.description},
              ${input.coverAssetId}::uuid, ${input.startsAt}::timestamptz, ${input.durationMin}::int,
              ${input.externalUrl})
      returning id`);
    const live = inserted[0];
    if (!live) throw new ApiError(500, 'INTERNAL');
    if (input.productIds.length > 0) {
      await tx.execute(sql`
        insert into course_live_products (tenant_id, live_id, product_id)
        select ${ctx.tenantId}::uuid, ${live.id}::uuid, ids.id
          from unnest(${uuidArray(input.productIds)}::uuid[]) as ids(id)
        on conflict (tenant_id, live_id, product_id) do nothing`);
    }
    const detail = await readLive(tx, ctx, live.id, new Date());
    if (!detail) throw new ApiError(500, 'INTERNAL');
    return detail;
  });

  log.info(
    {
      event: 'courses.live_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      liveId: detail.id,
      // The planned slot, never the title or the link (T-05-06).
      durationMin: detail.durationMin,
      status: detail.status,
      productCount: detail.products.length,
    },
    'course live created',
  );
  return detail;
}

/** `GET /v1/courses/lives/{liveId}`: the detail. An unknown or foreign id is ONE bare 404 (D-23). */
export async function getLive(ctx: RequestContext, liveId: string): Promise<LiveDetail> {
  const detail = await withTenantTx(ctx, (tx) => readLive(tx, ctx, liveId, new Date()));
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

/**
 * `PATCH /v1/courses/lives/{liveId}` (COURSE-11, A5, A6, P44, P45). ONE transaction: the row is
 * locked first (bare 404), a cancelled live refuses the whole patch (`409 live_cancelled`: a cancel
 * that raced in lands first or second, never beside), the references present are resolved in the
 * caller's lane (cover, every product ACTIVE and of this tenant), and a non-null `replayLessonId`
 * must be a LIVE lesson of this tenant (`400 lesson_invalid` by name — an unknown, removed or foreign
 * id alike, T-08.3-02) on a live that has ENDED by the values the patch leaves it with (`409
 * replay_too_early` otherwise). Then a dynamic `set` of only the keys present (`updated_at` always)
 * and, when `productIds` is present, the link set replaced. The same patch twice leaves the row's
 * values and the link rows as they were (P44).
 */
export async function updateLive(
  ctx: RequestContext,
  liveId: string,
  patch: LivePatch,
): Promise<LiveDetail> {
  const now = new Date();
  const detail = await withTenantTx(ctx, async (tx) => {
    const live = await lockLive(tx, ctx, liveId);
    if (!live) return null;
    if (live.cancelled_at !== null) {
      throw new ApiError(409, 'CONFLICT', { courses: 'live_cancelled' });
    }
    if (patch.coverAssetId !== undefined) {
      await resolveCoverAsset(tx, ctx, patch.coverAssetId, 'cover_invalid');
    }
    if (patch.productIds !== undefined) await resolveProducts(tx, ctx, patch.productIds);
    if (patch.replayLessonId !== undefined && patch.replayLessonId !== null) {
      const lesson = await tx.execute<{ id: string }>(sql`
        select id from course_lessons
         where id = ${patch.replayLessonId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid
           and deleted_at is null`);
      if (!lesson[0]) throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'lesson_invalid' });
      const after = {
        starts_at: patch.startsAt ?? live.starts_at,
        duration_min: patch.durationMin ?? live.duration_min,
        cancelled_at: null,
      };
      if (liveStatusOf(after, now) !== 'recorded') {
        throw new ApiError(409, 'CONFLICT', { courses: 'replay_too_early' });
      }
    }

    const sets = [sql`updated_at = now()`];
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
    if (patch.coverAssetId !== undefined) {
      sets.push(sql`cover_asset_id = ${patch.coverAssetId}::uuid`);
    }
    if (patch.startsAt !== undefined) sets.push(sql`starts_at = ${patch.startsAt}::timestamptz`);
    if (patch.durationMin !== undefined) sets.push(sql`duration_min = ${patch.durationMin}::int`);
    if (patch.externalUrl !== undefined) sets.push(sql`external_url = ${patch.externalUrl}`);
    if (patch.replayLessonId !== undefined) {
      sets.push(sql`replay_lesson_id = ${patch.replayLessonId}::uuid`);
    }
    await tx.execute(sql`
      update course_lives
         set ${sql.join(sets, sql`, `)}
       where id = ${liveId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    if (patch.productIds !== undefined) {
      await replaceLiveProducts(tx, ctx, liveId, patch.productIds);
    }
    return readLive(tx, ctx, liveId, now);
  });
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.live_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      liveId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof LivePatch] !== undefined),
      status: detail.status,
      productCount: detail.products.length,
    },
    'course live updated',
  );
  return detail;
}

/**
 * `POST /v1/courses/lives/{liveId}/cancel` (D-416, P44, P45): the row is locked (bare 404) and ONE
 * guarded write sets `cancelled_at` once — `coalesce(cancelled_at, now())` — so a second call, or two
 * concurrent ones serialised by the lock, answer 200 with the SAME instant and write nothing new.
 * Never a delete: the live keeps its time bucket with the "Cancelada" pill. Nobody is notified
 * (PR-10: no reminder, no push in this phase).
 */
export async function cancelLive(ctx: RequestContext, liveId: string): Promise<LiveDetail> {
  const result = await withTenantTx(ctx, async (tx) => {
    const live = await lockLive(tx, ctx, liveId);
    if (!live) return null;
    const first = live.cancelled_at === null;
    if (first) {
      await tx.execute(sql`
        update course_lives
           set cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
         where id = ${liveId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid`);
    }
    const detail = await readLive(tx, ctx, liveId, new Date());
    return detail ? { detail, first } : null;
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.live_cancelled',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      liveId,
      // `false` names the idempotent repeat (T-08.3-26: the cancel leaves a trace either way).
      transitioned: result.first,
    },
    'course live cancelled',
  );
  return result.detail;
}

type LessonPickerDbRow = {
  id: string;
  title: string;
  course_id: string;
  course_title: string;
  video_asset_id: string | null;
  video_status: string | null;
};

/**
 * `GET /v1/courses/lessons` (COURSE-11, UI-D-403): the tenant's LIVE lessons under LIVE modules,
 * each with its course, for the replay picker — course newest first (the catalogue's order), then
 * module position, then lesson position; capped at `LESSON_PICKER_MAX`. Every course status is
 * listed: a replay may live in a draft course the admin is still assembling.
 */
export async function listLessonsForPicker(ctx: RequestContext): Promise<LessonPickerList> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<LessonPickerDbRow>(sql`
      select l.id, l.title, c.id as course_id, c.title as course_title,
             l.video_asset_id, a.status as video_status
        from course_lessons l
        join course_modules m on m.id = l.module_id and m.tenant_id = l.tenant_id
        join courses c on c.id = l.course_id and c.tenant_id = l.tenant_id
        left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
       where l.tenant_id = ${ctx.tenantId}::uuid
         and l.deleted_at is null
         and m.deleted_at is null
       order by c.created_at desc, c.id desc, m.position asc, m.id asc, l.position asc, l.id asc
       limit ${LESSON_PICKER_MAX}`),
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      courseId: row.course_id,
      courseTitle: row.course_title,
      videoStatus: videoStatusOf(row.video_asset_id, row.video_status),
    })),
  };
}
