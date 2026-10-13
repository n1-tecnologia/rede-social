import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import type {
  CourseDetail,
  CourseInput,
  CourseLevel,
  CourseProduct,
  CourseStatus,
  CourseStatusBody,
  LessonInput,
  LessonVideoStatus,
  LessonView,
  ModuleInput,
  ModuleView,
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
 * A cover-type image (the course cover or the instructor photo), resolved INSIDE the writing
 * transaction (the store's `resolveImageAsset` rule): no row of THIS tenant (unknown, another
 * tenant's, removed) is ONE bare 404; a row of this tenant that is not a ready `cover` image is
 * `400 { courses: issue }`. A null id performs no lookup: "no image" is a first-class value (D-69).
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
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (!(asset.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready')) {
    throw new ApiError(400, 'VALIDATION_FAILED', { courses: issue });
  }
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
       and deleted_at is null`);
  if (used.length > 0) throw new ApiError(400, 'VALIDATION_FAILED', { courses: 'video_in_use' });
  return { status: asset.status, durationSeconds: asset.duration_seconds };
}

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
  const moduleRows = await tx.execute<ModuleRow>(sql`
    select id, title, summary, position, requires_previous
      from course_modules
     where tenant_id = ${ctx.tenantId}::uuid
       and course_id = ${course.id}::uuid
       and deleted_at is null
     order by position asc, created_at asc, id asc`);
  const lessonRows = await tx.execute<LessonRow>(sql`
    select l.id, l.module_id, l.title, l.description, l.position, l.is_free, l.video_asset_id,
           a.status as video_status, a.duration_seconds
      from course_lessons l
      left join media_assets a on a.id = l.video_asset_id and a.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and l.course_id = ${course.id}::uuid
       and l.deleted_at is null
     order by l.position asc, l.created_at asc, l.id asc`);

  const lessonsByModule = new Map<string, LessonView[]>();
  for (const row of lessonRows) {
    const list = lessonsByModule.get(row.module_id) ?? [];
    list.push(lessonView(row));
    lessonsByModule.set(row.module_id, list);
  }
  const modules = moduleRows.map((row) => moduleView(row, lessonsByModule.get(row.id) ?? []));
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
  const view = await withTenantTx(ctx, async (tx) => {
    const modules = await tx.execute<{ id: string; course_id: string }>(sql`
      select id, course_id from course_modules
       where id = ${moduleId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and deleted_at is null
         for update`);
    const module = modules[0];
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
