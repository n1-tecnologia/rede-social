import { LOCKED_COURSE_IDS } from '@rede-social/core/db/course-gate';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { assertTenantKey, mediaOriginalKey } from '@rede-social/core/server/media/keys';
import { signReadFor } from '@rede-social/core/server/media/storage';
import { encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  CourseLevel,
  LearnCataloguePage,
  LearnCatalogueQuery,
  LearnCategoryChip,
  LearnCategoryTile,
  LearnCourse,
  LearnLesson,
  LearnLive,
  LearnLiveCard,
  LearnLiveReplay,
  LearnLivesPage,
  LearnLivesQuery,
  LearnMaterial,
  LearnMyProgress,
  LearnNeighbour,
  LearnOutlineLesson,
  LearnOutlineModule,
  LearnOverview,
  LearnProgress,
  LearnTracks,
  LessonLockReason,
  LivePageState,
  MaterialUrl,
  MemberCourseRow,
  MemberLessonRow,
  MemberLiveCardRow,
  MemberTrackRow,
  ModuleLockReason,
  ProgressBody,
  ProgressResult,
} from '../contracts/index';
import {
  activeTrack,
  COURSE_PAGE_SIZE,
  courseShelf,
  heroResume,
  LESSON_COMPLETION_RATIO,
  liveJoinWindowAt,
  liveStatusAt,
  MATERIAL_URL_TTL_SECONDS,
  materialKind,
  newLessonsOf,
  nextLiveOf,
  overallStats,
  progressCourses,
  trackStates,
} from '../contracts/index';
import { decodeListCursor, videoStatusOf } from './service';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-courses');

/**
 * The member lane of the school (08.5, SC 1-3, COURSE-18..22; D-423, D-426, D-428..D-430, D-433).
 *
 * Every lock decision is the DATABASE's: one evaluator (`app.course_lesson_states`) and one access
 * answer (`app.course_lesson_access`), asked here, by the progress RLS `with check` and by the
 * kernel media gate (`app.course_asset_hidden`). This file never re-implements a rule: it reads the
 * tenant-pinned `SECURITY DEFINER` projections (`app.course_outline`, `app.course_lesson_content`,
 * `app.course_lesson_material_list`) inside ONE `withTenantTx` per request and maps their rows.
 *
 * Three facts a reader must not "fix":
 *  1. **Published only, for EVERY role** (D-426, R-Pitfall 11): the course is read with
 *     `status = 'published'` even for `admin_tenant` and `support_tenant`; staff bypass only the
 *     purchase and sequence locks. A draft, archived, unknown or foreign course is the bare 404.
 *  2. **The curriculum is titles only** (D-423, PR-1): a locked lesson's description, video asset
 *     id, materials and thumbnail never leave the server — `app.course_outline` does not return
 *     them, and nothing here asks for them unless `app.course_lesson_access` answered NULL.
 *  3. **Log lines carry ids and counts only**, never a title (the T-05-06 rule).
 */

/** The ISO 8601 UTC shape every timestamp leaves the service in (the events/store precedent). */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/** What `app.course_lesson_access` answers: NULL is open. */
type AccessReason = 'missing' | 'purchase' | 'sequence';

/**
 * The one refusal mapping of the member lane (CONTEXT "Error vocabulary"): `missing` is the bare
 * 404 (D-23 — unknown, foreign, removed, unpublished look alike), `purchase` is `403 FORBIDDEN
 * { courses: 'lesson_locked' }` (the web shows the buy path), `sequence` is `409 CONFLICT
 * { courses: 'lesson_sequence_locked' }` (the web shows "Libera ao concluir …"). The details carry
 * the code and nothing else: no title, no id, no product.
 */
export function refuseLesson(reason: AccessReason): never {
  if (reason === 'purchase') throw new ApiError(403, 'FORBIDDEN', { courses: 'lesson_locked' });
  if (reason === 'sequence') {
    throw new ApiError(409, 'CONFLICT', { courses: 'lesson_sequence_locked' });
  }
  throw new ApiError(404, 'NOT_FOUND');
}

type CourseHeaderRow = {
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
  locked: boolean;
};

type OutlineRow = {
  module_id: string;
  module_title: string;
  module_position: number;
  module_number: number;
  module_requires_previous: boolean;
  lesson_id: string;
  lesson_title: string;
  lesson_position: number;
  lesson_number: number;
  course_seq: number;
  is_free: boolean;
  requires_previous: boolean;
  duration_seconds: number | null;
  has_video: boolean;
  lock_reason: LessonLockReason | null;
  completed_at: string | null;
  last_position_seconds: number;
};

type ContentRow = {
  lesson_id: string;
  course_id: string;
  module_id: string;
  title: string;
  description: string;
  is_free: boolean;
  video_asset_id: string | null;
  video_status: string | null;
  duration_seconds: number | null;
};

type MaterialRow = {
  material_id: string;
  filename: string;
  mime: string;
  bytes: number | string;
};

/**
 * The PUBLISHED course of THIS tenant in the caller's lane (D-426), with `locked` from the kernel
 * seam (`'{}'` for staff, the store off or no link). `null` is the bare 404.
 */
async function readPublishedCourse(
  tx: Tx,
  ctx: RequestContext,
  courseId: string,
): Promise<CourseHeaderRow | null> {
  const rows = await tx.execute<CourseHeaderRow>(sql`
    select c.id, c.title, c.tagline, c.description, c.category_id, k.name as category_name,
           c.level, c.cover_asset_id, c.instructor_name, c.instructor_photo_asset_id, c.outcomes,
           c.certificate_hours,
           c.id = any (${LOCKED_COURSE_IDS}) as locked
      from courses c
      left join course_categories k on k.id = c.category_id and k.tenant_id = c.tenant_id
     where c.id = ${courseId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.status = 'published'`);
  return rows[0] ?? null;
}

/**
 * The titles-only curriculum (`app.course_outline`, D-423) in course order. Explicit columns:
 * nothing the projection does not return can be asked for here either (R-Pitfall 8).
 */
async function readOutline(tx: Tx, courseId: string): Promise<OutlineRow[]> {
  return tx.execute<OutlineRow>(sql`
    select o.module_id, o.module_title, o.module_position, o.module_number,
           o.module_requires_previous, o.lesson_id, o.lesson_title, o.lesson_position,
           o.lesson_number, o.course_seq, o.is_free, o.requires_previous, o.duration_seconds,
           o.has_video, o.lock_reason,
           to_char(o.completed_at at time zone 'utc', ${ISO_MICROSECONDS}) as completed_at,
           o.last_position_seconds
      from app.course_outline(${courseId}::uuid) o
     order by o.course_seq`);
}

/** One outline row as the contract's lesson: exactly the EP-14 keys, never content. */
function outlineLesson(row: OutlineRow): LearnOutlineLesson {
  return {
    id: row.lesson_id,
    title: row.lesson_title,
    position: row.lesson_position,
    number: row.lesson_number,
    durationSeconds: row.duration_seconds,
    hasVideo: row.has_video,
    isFree: row.is_free,
    requiresPrevious: row.requires_previous,
    lockReason: row.lock_reason,
    completedAt: row.completed_at,
    lastPositionSeconds: row.last_position_seconds,
  };
}

/**
 * The outline rows grouped into modules, in course order. A module reads `module` when any of its
 * lessons is held by the module rule, else `purchase` when the course is locked and any of its
 * lessons is held by the purchase, else null.
 */
function groupModules(rows: readonly OutlineRow[], courseLocked: boolean): LearnOutlineModule[] {
  const modules: LearnOutlineModule[] = [];
  const byId = new Map<string, LearnOutlineModule>();
  for (const row of rows) {
    let module = byId.get(row.module_id);
    if (!module) {
      module = {
        id: row.module_id,
        title: row.module_title,
        position: row.module_position,
        number: row.module_number,
        requiresPrevious: row.module_requires_previous,
        lockReason: null,
        lessons: [],
      };
      byId.set(row.module_id, module);
      modules.push(module);
    }
    module.lessons.push(outlineLesson(row));
  }
  for (const module of modules) {
    const reasons = new Set(module.lessons.map((lesson) => lesson.lockReason));
    let reason: ModuleLockReason | null = null;
    if (reasons.has('module')) reason = 'module';
    else if (courseLocked && reasons.has('purchase')) reason = 'purchase';
    module.lockReason = reason;
  }
  return modules;
}

/**
 * D-430: the progress summary from the outline rows. `percent = floor(done * 100 / total)`, 0 when
 * `total` is 0 (EP-16); `nextLessonId` is the first lesson in course order neither completed nor
 * locked.
 */
function progressOf(rows: readonly OutlineRow[]): LearnProgress {
  const total = rows.length;
  const done = rows.filter((row) => row.completed_at !== null).length;
  const next = rows.find((row) => row.completed_at === null && row.lock_reason === null);
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.floor((done * 100) / total),
    nextLessonId: next?.lesson_id ?? null,
    firstLessonId: rows[0]?.lesson_id ?? null,
    firstFreeLessonId: rows.find((row) => row.is_free)?.lesson_id ?? null,
  };
}

/**
 * `GET /v1/courses/learn/courses/{courseId}` (SC 2, COURSE-18, COURSE-19): a published course as the
 * member's course page reads it — the header, `locked`, every live module and lesson BY TITLE with
 * its lock reason and the caller's own progress, and the summary. ONE tenant transaction.
 */
export async function getLearnCourse(ctx: RequestContext, courseId: string): Promise<LearnCourse> {
  const answer = await withTenantTx(ctx, async (tx) => {
    const course = await readPublishedCourse(tx, ctx, courseId);
    if (!course) return null;
    const rows = await readOutline(tx, course.id);
    return { course, rows };
  });
  if (!answer) throw new ApiError(404, 'NOT_FOUND');
  const { course, rows } = answer;
  const modules = groupModules(rows, course.locked);

  log.info(
    {
      event: 'courses.learn_course_read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId: course.id,
      locked: course.locked,
      moduleCount: modules.length,
      lessonCount: rows.length,
    },
    'member course read',
  );

  return {
    id: course.id,
    title: course.title,
    tagline: course.tagline,
    description: course.description,
    coverAssetId: course.cover_asset_id,
    category:
      course.category_id && course.category_name !== null
        ? { id: course.category_id, name: course.category_name }
        : null,
    level: course.level as CourseLevel | null,
    instructorName: course.instructor_name,
    instructorPhotoAssetId: course.instructor_photo_asset_id,
    outcomes: course.outcomes,
    certificateHours: course.certificate_hours,
    locked: course.locked,
    modules,
    progress: progressOf(rows),
  };
}

/** A neighbour in course order, with the caller's lock reason (the prev/next buttons, UI-D-430). */
function neighbour(row: OutlineRow | undefined): LearnNeighbour | null {
  return row ? { id: row.lesson_id, lockReason: row.lock_reason } : null;
}

/**
 * `GET /v1/courses/learn/lessons/{lessonId}` (SC 3, COURSE-19, COURSE-22): an OPEN lesson as the
 * member's player reads it. ONE tenant transaction:
 *  1. `app.course_lesson_access` — non-null is refused (`refuseLesson`) before any content is read;
 *  2. the content (`app.course_lesson_content`) and the ready materials
 *     (`app.course_lesson_material_list`, mapped WITHOUT the asset id);
 *  3. the course header by a lane read of the PUBLISHED course — a lesson that opened only through
 *     the live door (D-433) while its course is unpublished is the bare 404 here: the course player
 *     needs its course, and the live page reads the replay itself (plan 04);
 *  4. the outline of that course for the module and lesson numbers, the module's lessons and
 *     progress, the neighbours in course order and the caller's own progress row.
 */
export async function getLearnLesson(ctx: RequestContext, lessonId: string): Promise<LearnLesson> {
  const answer = await withTenantTx(ctx, async (tx) => {
    await assertOpenLesson(tx, lessonId);

    const [content] = await tx.execute<ContentRow>(sql`
      select x.lesson_id, x.course_id, x.module_id, x.title, x.description, x.is_free,
             x.video_asset_id, x.video_status, x.duration_seconds
        from app.course_lesson_content(${lessonId}::uuid) x`);
    if (!content) return null;

    const course = await readPublishedCourse(tx, ctx, content.course_id);
    if (!course) return null;

    const materials = await tx.execute<MaterialRow>(sql`
      select x.material_id, x.filename, x.mime, x.bytes
        from app.course_lesson_material_list(${lessonId}::uuid) x
       order by x.position, x.material_id`);
    const rows = await readOutline(tx, course.id);
    return { content, course, materials, rows };
  });
  if (!answer) throw new ApiError(404, 'NOT_FOUND');
  const { content, course, materials, rows } = answer;

  const index = rows.findIndex((row) => row.lesson_id === content.lesson_id);
  const own = rows[index];
  // The access answer said open and the course is published, so the lesson is in its outline; a
  // concurrent removal between the statements is the only way here, and it reads as a miss.
  if (!own) throw new ApiError(404, 'NOT_FOUND');
  const moduleRows = rows.filter((row) => row.module_id === own.module_id);
  const videoStatus = videoStatusOf(content.video_asset_id, content.video_status);

  log.info(
    {
      event: 'courses.learn_lesson_read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      courseId: course.id,
      lessonId: content.lesson_id,
      materialCount: materials.length,
    },
    'member lesson read',
  );

  return {
    id: content.lesson_id,
    courseId: course.id,
    courseTitle: course.title,
    coverAssetId: course.cover_asset_id,
    instructorName: course.instructor_name,
    instructorPhotoAssetId: course.instructor_photo_asset_id,
    moduleId: own.module_id,
    moduleTitle: own.module_title,
    moduleNumber: own.module_number,
    lessonNumber: own.lesson_number,
    title: content.title,
    description: content.description,
    isFree: content.is_free,
    videoAssetId: content.video_asset_id,
    videoStatus,
    durationSeconds: videoStatus === 'ready' ? (content.duration_seconds ?? 0) : null,
    materials: materials.map(
      (row): LearnMaterial => ({
        id: row.material_id,
        filename: row.filename,
        kind: materialKind(row.mime),
        mime: row.mime,
        bytes: Number(row.bytes),
      }),
    ),
    progress: { completedAt: own.completed_at, lastPositionSeconds: own.last_position_seconds },
    moduleLessons: moduleRows.map(outlineLesson),
    moduleProgress: {
      done: moduleRows.filter((row) => row.completed_at !== null).length,
      total: moduleRows.length,
    },
    previous: neighbour(rows[index - 1]),
    next: neighbour(rows[index + 1]),
  };
}

/**
 * One access answer for the member's writes: `app.course_lesson_access` in the caller's lane, refused
 * by the shared vocabulary (`refuseLesson`) when non-null. Runs inside the caller's transaction, so
 * nothing caches it: a revoked entitlement refuses the very next request (EP-18).
 */
async function assertOpenLesson(tx: Tx, lessonId: string): Promise<void> {
  const [access] = await tx.execute<{ reason: AccessReason | null }>(
    sql`select app.course_lesson_access(${lessonId}::uuid) as reason`,
  );
  if (!access || access.reason !== null) refuseLesson(access?.reason ?? 'missing');
}

type ProgressRow = {
  completed_at: string | null;
  last_position_seconds: number;
  newly_completed: boolean;
};

/**
 * `PUT /v1/courses/learn/lessons/{lessonId}/progress` (D-427, D-429, D-422, COURSE-21, SC 4): the
 * caller's OWN progress row on a lesson they can open. Answers `null` (the route's 204, nothing
 * written, no transaction opened) for `admin_tenant` — the "Ver como aluno" preview never records
 * progress (D-422; the RLS `with check` refuses the admin claim too, T-08.5-17). Otherwise ONE tenant
 * transaction:
 *  1. the access answer — a lesson the caller cannot open is the bare 404, `403 lesson_locked` or
 *     `409 lesson_sequence_locked`, and nothing is written (the RLS `with check` asks the same
 *     function, so a skip is refused twice, T-08.5-06);
 *  2. the lesson's ready video duration (`app.course_lesson_content`; 0 without a ready video);
 *  3. the position is clamped to `[0, duration]`; the lesson completes when `completed: true` was
 *     sent or when `duration > 0` and the clamped position reaches `ceil(0.9 * duration)` — the
 *     SERVER decides, from its own duration (R-Pitfall 10);
 *  4. ONE upsert on the primary key (`on conflict … do update`, the PK arbitrates concurrent writes,
 *     EP-24): the position is the last write's (EP-22) — a body with only `completed` keeps the
 *     stored position — and `completed_at` is `coalesce(stored, new)`, so a completion never moves
 *     and never reverts (one-way, EP-23).
 * A free lesson writes for a non-buyer (D-429): after a purchase the row already counts. The body
 * carries no user or tenant: the lane stamps them. The log line carries the lesson id and two
 * booleans, never a position or another member's anything (PR-2).
 */
export async function writeLessonProgress(
  ctx: RequestContext,
  lessonId: string,
  body: ProgressBody,
): Promise<ProgressResult | null> {
  if (ctx.role === 'admin_tenant') return null;

  const row = await withTenantTx(ctx, async (tx) => {
    await assertOpenLesson(tx, lessonId);
    const [content] = await tx.execute<{
      video_status: string | null;
      duration_seconds: number | null;
    }>(
      sql`select x.video_status, x.duration_seconds
            from app.course_lesson_content(${lessonId}::uuid) x`,
    );
    // The access answer said open, so the lesson is readable; a removal racing this write reads as
    // a miss.
    if (!content) return null;
    const duration =
      content.video_status === 'ready' ? Math.max(content.duration_seconds ?? 0, 0) : 0;
    const keepPosition = body.positionSeconds === undefined;
    const position = Math.min(Math.max(body.positionSeconds ?? 0, 0), duration);
    const complete =
      body.completed === true ||
      (duration > 0 && position >= Math.ceil(LESSON_COMPLETION_RATIO * duration));
    // `now()` is the transaction's instant: `completed_at = now()` after the upsert means THIS write
    // set it (a stored completion is an earlier transaction's instant). Logged only.
    const [written] = await tx.execute<ProgressRow>(sql`
      insert into course_lesson_progress
             (tenant_id, user_id, lesson_id, last_position_seconds, completed_at)
      values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${lessonId}::uuid, ${position},
              ${complete ? sql`now()` : sql`null`})
      on conflict (tenant_id, user_id, lesson_id) do update
         set last_position_seconds = ${
           keepPosition
             ? sql`least(course_lesson_progress.last_position_seconds, ${duration})`
             : sql`excluded.last_position_seconds`
},
             completed_at = coalesce(course_lesson_progress.completed_at, excluded.completed_at),
             updated_at = now()
      returning to_char(completed_at at time zone 'utc', ${ISO_MICROSECONDS}) as completed_at,
                last_position_seconds,
                coalesce(completed_at = now(), false) as newly_completed`);
    return written ?? null;
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'courses.lesson_progress',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
      completed: row.completed_at !== null,
      newlyCompleted: row.newly_completed,
    },
    'member lesson progress written',
  );
  return { completedAt: row.completed_at, lastPositionSeconds: row.last_position_seconds };
}

/**
 * `GET /v1/courses/learn/lessons/{lessonId}/materials/{materialId}/url` (COURSE-19, D-428, CONTEXT
 * "T-08.3-08 closure"): the member's ten-minute signed URL for a material of a lesson they can open.
 * ONE tenant transaction: the access answer first (bare 404 / `403 lesson_locked` / `409
 * lesson_sequence_locked`), then the material must be in `app.course_lesson_material_list(lessonId)`
 * — a ready, live material of THAT open lesson; another lesson's, an unknown or a foreign id is the
 * bare 404 (T-08.5-20). Then exactly the admin signer's posture (`materialUrl`): the key is built
 * from the CALLER's tenant id, asserted under that prefix, and `signReadFor(key, 600)` mints a fresh
 * URL per request (no memo, nothing written, EP-17). The URL is never logged.
 */
export async function learnMaterialUrl(
  ctx: RequestContext,
  lessonId: string,
  materialId: string,
): Promise<MaterialUrl> {
  const assetId = await withTenantTx(ctx, async (tx) => {
    await assertOpenLesson(tx, lessonId);
    const [row] = await tx.execute<{ asset_id: string }>(sql`
      select x.asset_id
        from app.course_lesson_material_list(${lessonId}::uuid) x
       where x.material_id = ${materialId}::uuid`);
    return row?.asset_id ?? null;
  });
  if (!assetId) throw new ApiError(404, 'NOT_FOUND');

  const key = mediaOriginalKey(ctx.tenantId, assetId);
  assertTenantKey(key, ctx.tenantId);
  const url = await signReadFor(key, MATERIAL_URL_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + MATERIAL_URL_TTL_SECONDS * 1000).toISOString();

  log.info(
    {
      event: 'courses.learn_material_url',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      lessonId,
      materialId,
      // The ids only — never the URL (T-08.3-06).
      ttlSeconds: MATERIAL_URL_TTL_SECONDS,
    },
    'member material url minted',
  );
  return { url, expiresAt };
}

// ── Member catalogue (08.5-04, D-420, D-421, D-426, D-430, COURSE-17) ───────────────────────────

type CatalogueRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  category_id: string | null;
  category_name: string | null;
  level: string | null;
  lesson_count: number;
  duration_seconds: number;
  completed_count: number;
  locked: boolean;
  published_at: string;
};

/**
 * `GET /v1/courses/learn/courses?categoryId=&cursor=&limit=` (SC 1, COURSE-17; D-420, D-421, D-426,
 * D-430). ONE tenant transaction, two statements:
 *  1. the page: a lane select of THIS tenant's PUBLISHED courses (D-426: a draft or an archived
 *     course is absent for every role, buyers and staff included), the optional category filter,
 *     keyset over `(published_at desc, id desc)` — `published_at` is set once on the first
 *     publication, so a republish keeps its place — over-fetching by one so `nextCursor` is non-null
 *     exactly when another course exists. `locked` is the kernel seam (`'{}'` for staff and with the
 *     store off); the three counts come from `app.course_catalogue_stats()`, so a locked course
 *     still shows its FULL lesson count and duration, and `completedCount` is the caller's own
 *     completions (free lessons included, A-UI-5). Locked and open courses come in ONE list (D-420);
 *  2. the chips (D-421): the categories holding at least one published course, `lower(name), id`,
 *     whatever the cursor and the filter.
 * The log line carries counts only, never a title (T-05-06).
 */
export async function listLearnCatalogue(
  ctx: RequestContext,
  query: LearnCatalogueQuery,
): Promise<LearnCataloguePage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const categoryId = query.categoryId ?? null;

  const { rows, categories } = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<CatalogueRow>(sql`
      select c.id, c.title, c.cover_asset_id, c.category_id, k.name as category_name, c.level,
             coalesce(s.lesson_count, 0)::int as lesson_count,
             coalesce(s.duration_seconds, 0)::int as duration_seconds,
             coalesce(s.completed_count, 0)::int as completed_count,
             c.id = any (${LOCKED_COURSE_IDS}) as locked,
             to_char(c.published_at at time zone 'utc', ${ISO_MICROSECONDS}) as published_at
        from courses c
        left join course_categories k on k.id = c.category_id and k.tenant_id = c.tenant_id
        left join app.course_catalogue_stats() s on s.course_id = c.id
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.status = 'published'
         and (${categoryId}::uuid is null or c.category_id = ${categoryId}::uuid)
         and (
           ${afterAt}::timestamptz is null
           or (c.published_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.published_at desc, c.id desc
       limit ${limit + 1}`);
    const categories = await tx.execute<LearnCategoryChip>(sql`
      select k.id, k.name
        from course_categories k
       where k.tenant_id = ${ctx.tenantId}::uuid
         and exists (select 1
                       from courses c
                      where c.category_id = k.id
                        and c.tenant_id = k.tenant_id
                        and c.status = 'published')
       order by lower(k.name), k.id`);
    return { rows, categories };
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.published_at, id: last.id }) : null;

  log.info(
    {
      event: 'courses.learn_catalogue_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      filtered: categoryId !== null,
      limit,
      returned: page.length,
      locked: page.filter((row) => row.locked).length,
      categories: categories.length,
      hasNext: nextCursor !== null,
    },
    'member catalogue listed',
  );

  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      coverAssetId: row.cover_asset_id,
      category:
        row.category_id && row.category_name !== null
          ? { id: row.category_id, name: row.category_name }
          : null,
      level: row.level as CourseLevel | null,
      lessonCount: row.lesson_count,
      durationSeconds: row.duration_seconds,
      completedCount: row.completed_count,
      locked: row.locked,
    })),
    categories: categories.map((row) => ({ id: row.id, name: row.name })),
    nextCursor,
  };
}

// ── Member lives (08.5-04, D-431..D-434, COURSE-23, COURSE-24) ──────────────────────────────────

type LiveCardRow = {
  id: string;
  title: string;
  description: string;
  cover_asset_id: string | null;
  starts_at: string;
  duration_min: number;
  ends_at: string;
  cancelled_at: string | null;
  locked: boolean;
  has_replay: boolean;
};

/**
 * The columns of `app.course_live_cards` as the member lane reads them: never `external_url` and
 * never `replay_lesson_id` — the projection does not return them (PR-1). Instants leave as the
 * microsecond ISO the cursor helper accepts.
 */
const LIVE_CARD_COLUMNS = sql`
  x.live_id as id, x.title, x.description, x.cover_asset_id, x.duration_min, x.locked,
  x.has_replay,
  to_char(x.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
  to_char((x.starts_at + make_interval(mins => x.duration_min)) at time zone 'utc',
          ${ISO_MICROSECONDS}) as ends_at,
  to_char(x.cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at`;

/**
 * A live's planned end compared to the request's instant at MILLISECOND precision: JavaScript's
 * `Date` (which `liveStatusAt` reads) truncates the stored microseconds, so the SQL group filter and
 * the status on the card agree to the instant (EP-28).
 */
const LIVE_END_MS = sql`date_trunc('milliseconds', x.starts_at) + make_interval(mins => x.duration_min)`;

const clockOf = (row: LiveCardRow) => ({
  startsAt: row.starts_at,
  durationMin: row.duration_min,
  cancelledAt: row.cancelled_at,
});

function toLiveCard(row: LiveCardRow, now: Date, locked = row.locked): LearnLiveCard {
  return {
    id: row.id,
    title: row.title,
    coverAssetId: row.cover_asset_id,
    startsAt: row.starts_at,
    durationMin: row.duration_min,
    endsAt: row.ends_at,
    status: liveStatusAt(clockOf(row), now),
    locked,
    hasReplay: row.has_replay,
  };
}

/**
 * `GET /v1/courses/learn/lives?cursor=` (SC 5, COURSE-23, D-431). ONE tenant transaction and ONE
 * instant (`now`, the server clock) for the group filters and every card's status:
 *  - `upcoming` (first page only — the group is small and nearest first, UI-D-434): every live whose
 *    planned end is still ahead — live now, scheduled, and cancelled ones until their planned end —
 *    `starts_at asc, id asc`;
 *  - `recorded`: ended, not cancelled lives with a live replay lesson, `starts_at desc, id desc`,
 *    keyset over `(starts_at, id)` with the over-fetch-by-one cursor rule, 20 per page. Filter and
 *    order are SQL's.
 * An ended live without a replay and a cancelled live after its planned end are absent. Every card
 * comes from `app.course_live_cards()`, so a locked live is listed with `locked: true` and no card
 * carries the room link or the replay lesson id.
 */
export async function listLearnLives(
  ctx: RequestContext,
  query: LearnLivesQuery,
): Promise<LearnLivesPage> {
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const limit = COURSE_PAGE_SIZE;
  const now = new Date();
  const nowIso = now.toISOString();

  const { upcoming, recorded } = await withTenantTx(ctx, async (tx) => {
    const upcoming = after
      ? []
      : await tx.execute<LiveCardRow>(sql`
          select ${LIVE_CARD_COLUMNS}
            from app.course_live_cards() x
           where ${LIVE_END_MS} > ${nowIso}::timestamptz
           order by x.starts_at asc, x.live_id asc`);
    const recorded = await tx.execute<LiveCardRow>(sql`
      select ${LIVE_CARD_COLUMNS}
        from app.course_live_cards() x
       where x.cancelled_at is null
         and x.has_replay
         and ${LIVE_END_MS} <= ${nowIso}::timestamptz
         and (
           ${afterAt}::timestamptz is null
           or (x.starts_at, x.live_id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by x.starts_at desc, x.live_id desc
       limit ${limit + 1}`);
    return { upcoming, recorded };
  });

  const page = recorded.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    recorded.length > limit && last ? encodeCursor({ n: last.starts_at, id: last.id }) : null;

  log.info(
    {
      event: 'courses.learn_lives_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      upcoming: upcoming.length,
      recorded: page.length,
      locked: [...upcoming, ...page].filter((row) => row.locked).length,
      hasNext: nextCursor !== null,
    },
    'member lives listed',
  );

  return {
    upcoming: upcoming.map((row) => toLiveCard(row, now)),
    recorded: page.map((row) => toLiveCard(row, now)),
    nextCursor,
  };
}

/** `YYYY-MM-DD` of an instant in `timeZone` (the tenant's), for `startsToday` (UI-D-436). */
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

type LiveLaneRow = { external_url: string; replay_lesson_id: string | null };

/**
 * `GET /v1/courses/learn/lives/{liveId}` (SC 5, COURSE-24; D-432, D-433, D-434, UI-D-435, UI-D-436,
 * UI-D-441). ONE tenant transaction and ONE server instant:
 *  1. the card from `app.course_live_cards(liveId)` — no row (unknown or another tenant's) is the
 *     bare 404; a cancelled live keeps its page (UI-D-441);
 *  2. the tenant's timezone for `startsToday`;
 *  3. ONLY when the card is neither locked nor cancelled, a LANE read of the room link and the replay
 *     pointer from `course_lives` under its restrictive live gate (never a definer projection); no
 *     row means the gate hid it, and the live is treated as locked;
 *  4. ONLY when that lane row exists, the live is `recorded` and a replay lesson is set, the replay
 *     through `app.course_lesson_content` / `app.course_lesson_material_list` — whose access answer
 *     opens through the LIVE door even when the caller lacks the lesson's course, and ignores its
 *     sequential lock (D-433) — plus the caller's own progress row on it.
 * `state` follows the EP-33 precedence; `joinUrl` is the stored link only in the `open` state (the
 * 15-minute window on the server clock, `liveJoinWindowAt`), so a member without access, a live
 * before its window and an ended live never receive it (T-08.5-07). The log line carries the live id
 * and the state, never the link (T-08.3-06).
 */
export async function getLearnLive(ctx: RequestContext, liveId: string): Promise<LearnLive> {
  const now = new Date();

  const answer = await withTenantTx(ctx, async (tx) => {
    const [card] = await tx.execute<LiveCardRow>(sql`
      select ${LIVE_CARD_COLUMNS}
        from app.course_live_cards(${liveId}::uuid) x`);
    if (!card) return null;
    const [tenant] = await tx.execute<{ timezone: string }>(sql`
      select timezone from tenants where id = ${ctx.tenantId}::uuid`);

    let lane: LiveLaneRow | null = null;
    if (!card.locked && card.cancelled_at === null) {
      const rows = await tx.execute<LiveLaneRow>(sql`
        select v.external_url, v.replay_lesson_id
          from course_lives v
         where v.id = ${card.id}::uuid
           and v.tenant_id = ${ctx.tenantId}::uuid`);
      lane = rows[0] ?? null;
    }

    let replay: LearnLiveReplay | null = null;
    const replayLessonId = lane?.replay_lesson_id ?? null;
    if (replayLessonId && liveStatusAt(clockOf(card), now) === 'recorded') {
      const [content] = await tx.execute<ContentRow>(sql`
        select x.lesson_id, x.course_id, x.module_id, x.title, x.description, x.is_free,
               x.video_asset_id, x.video_status, x.duration_seconds
          from app.course_lesson_content(${replayLessonId}::uuid) x`);
      if (content) {
        const materials = await tx.execute<MaterialRow>(sql`
          select x.material_id, x.filename, x.mime, x.bytes
            from app.course_lesson_material_list(${replayLessonId}::uuid) x
           order by x.position, x.material_id`);
        const [progress] = await tx.execute<{
          completed_at: string | null;
          last_position_seconds: number;
        }>(sql`
          select to_char(p.completed_at at time zone 'utc', ${ISO_MICROSECONDS}) as completed_at,
                 p.last_position_seconds
            from course_lesson_progress p
           where p.tenant_id = ${ctx.tenantId}::uuid
             and p.user_id = ${ctx.userId}::uuid
             and p.lesson_id = ${replayLessonId}::uuid`);
        const videoStatus = videoStatusOf(content.video_asset_id, content.video_status);
        replay = {
          lessonId: content.lesson_id,
          videoAssetId: content.video_asset_id,
          videoStatus,
          durationSeconds: videoStatus === 'ready' ? (content.duration_seconds ?? 0) : null,
          materials: materials.map(
            (row): LearnMaterial => ({
              id: row.material_id,
              filename: row.filename,
              kind: materialKind(row.mime),
              mime: row.mime,
              bytes: Number(row.bytes),
            }),
          ),
          progress: {
            completedAt: progress?.completed_at ?? null,
            lastPositionSeconds: progress?.last_position_seconds ?? 0,
          },
        };
      }
    }
    return { card, timezone: tenant?.timezone ?? 'America/Sao_Paulo', lane, replay };
  });
  if (!answer) throw new ApiError(404, 'NOT_FOUND');
  const { card, timezone, lane, replay } = answer;

  const window = liveJoinWindowAt(clockOf(card), now);
  // The restrictive gate hid the row from a caller the projection called unlocked: locked.
  const locked = card.locked || (card.cancelled_at === null && lane === null);
  let state: LivePageState;
  if (card.cancelled_at !== null) state = 'cancelled';
  else if (locked) state = 'locked';
  else if (window.open) state = 'open';
  else if (now < window.opensAt) state = 'before';
  else if (replay) state = 'replay';
  else state = 'ended';

  log.info(
    {
      event: 'courses.learn_live_read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      liveId: card.id,
      // The state only — never the room link (T-08.5-07).
      state,
    },
    'member live read',
  );

  return {
    ...toLiveCard(card, now, locked),
    description: card.description,
    state,
    joinUrl: state === 'open' && lane ? lane.external_url : null,
    joinOpensAt: window.opensAt.toISOString(),
    serverNow: now.toISOString(),
    startsToday: localDate(new Date(card.starts_at), timezone) === localDate(now, timezone),
    replay: state === 'replay' ? replay : null,
  };
}

// ── Member area (08.6-01, D-437, D-440, D-441, D-443, COURSE-29, COURSE-37) ─────────────────────

type MemberCourseSqlRow = {
  id: string;
  title: string;
  tagline: string;
  cover_asset_id: string | null;
  published_at: string;
  locked: boolean;
};

type MemberLessonSqlRow = {
  course_id: string;
  module_id: string;
  lesson_id: string;
  course_seq: number;
  module_seq: number;
  lesson_title: string;
  module_title: string;
  is_free: boolean;
  duration_seconds: number | null;
  lock_reason: LessonLockReason | null;
  completed_at: string | null;
  touched_at: string | null;
  lesson_created_at: string;
};

type MemberTrackSqlRow = { id: string; title: string; cover_asset_id: string | null };
type MemberLiveSqlRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  duration_min: number;
  cancelled_at: string | null;
  locked: boolean;
};
type CategoryTileSqlRow = {
  id: string;
  name: string;
  cover_asset_id: string | null;
  count: number;
};
type MemberTrackLinkSqlRow = { track_id: string; course_id: string };

/**
 * The ACTIVE tracks in admin order with their paths (08.6-03 planning decision 3): only the course
 * ids present in `published` (the published-course list read in the same transaction) are kept,
 * so a draft or archived course drops out at read time and the admin's link rows stay untouched.
 */
function memberTrackRows(
  tracks: readonly MemberTrackSqlRow[],
  links: readonly MemberTrackLinkSqlRow[],
  published: ReadonlySet<string>,
): MemberTrackRow[] {
  const paths = new Map<string, string[]>();
  for (const link of links) {
    if (!published.has(link.course_id)) continue;
    const path = paths.get(link.track_id);
    if (path) path.push(link.course_id);
    else paths.set(link.track_id, [link.course_id]);
  }
  return tracks.map((track) => ({
    id: track.id,
    title: track.title,
    coverAssetId: track.cover_asset_id,
    courseIds: paths.get(track.id) ?? [],
  }));
}

function memberLessonRow(row: MemberLessonSqlRow): MemberLessonRow {
  return {
    courseId: row.course_id,
    moduleId: row.module_id,
    lessonId: row.lesson_id,
    courseSeq: row.course_seq,
    moduleSeq: row.module_seq,
    lessonTitle: row.lesson_title,
    moduleTitle: row.module_title,
    isFree: row.is_free,
    durationSeconds: row.duration_seconds,
    lockReason: row.lock_reason,
    completedAt: row.completed_at,
    touchedAt: row.touched_at,
    lessonCreatedAt: row.lesson_created_at,
  };
}

/** The member area's shared rows (08.6-04 planning decision 1), mapped to the helpers' types. */
interface MemberAreaRead {
  /** The transaction's `now()` as the microsecond ISO (the overview's one instant). */
  serverNow: string;
  streakDays: number;
  courses: MemberCourseRow[];
  lessons: MemberLessonRow[];
  tracks: MemberTrackRow[];
}

/**
 * The ONE row read the overview, the tracks and the progress answers share (08.6-04 planning
 * decision 1), inside the caller's `withTenantTx`, so the three answers can never disagree about a
 * state:
 *  (a) the PUBLISHED courses of the tenant with `locked` exactly as the catalogue reads it (the
 *      kernel seam; `'{}'` for staff and with the store off), in catalogue order
 *      (`published_at desc, id desc`), unpaged;
 *  (b) `app.course_member_lessons()` — the one member projection over the evaluator (no lane read
 *      of `course_lessons`), the caller's own progress only (`app.user_id()`, T-08.6-22);
 *  (c) the ACTIVE tracks in the admin order (`created_at desc, id desc`) and their link rows in path
 *      order; each path keeps only the published courses of (a) (08.6-03 planning decision 3);
 *  (d) `app.course_member_streak()` and the transaction's instant as `serverNow`.
 * Nothing here is decided: the pure helpers decide over these rows.
 */
async function readMemberArea(tx: Tx, ctx: RequestContext): Promise<MemberAreaRead> {
  const courseRows = await tx.execute<MemberCourseSqlRow>(sql`
    select c.id, c.title, c.tagline, c.cover_asset_id,
           c.id = any (${LOCKED_COURSE_IDS}) as locked,
           to_char(c.published_at at time zone 'utc', ${ISO_MICROSECONDS}) as published_at
      from courses c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.status = 'published'
     order by c.published_at desc, c.id desc`);
  const lessonRows = await tx.execute<MemberLessonSqlRow>(sql`
    select x.course_id, x.module_id, x.lesson_id, x.course_seq, x.module_seq, x.lesson_title,
           x.module_title, x.is_free, x.duration_seconds, x.lock_reason,
           to_char(x.completed_at at time zone 'utc', ${ISO_MICROSECONDS}) as completed_at,
           to_char(x.touched_at at time zone 'utc', ${ISO_MICROSECONDS}) as touched_at,
           to_char(x.lesson_created_at at time zone 'utc', ${ISO_MICROSECONDS})
             as lesson_created_at
      from app.course_member_lessons() x
     order by x.course_id, x.course_seq`);
  // D-438 / A14: the active tracks in the admin order, and their paths in path order.
  const trackRows = await tx.execute<MemberTrackSqlRow>(sql`
    select t.id, t.title, t.cover_asset_id
      from course_tracks t
     where t.tenant_id = ${ctx.tenantId}::uuid
       and t.status = 'active'
     order by t.created_at desc, t.id desc`);
  const links = await tx.execute<MemberTrackLinkSqlRow>(sql`
    select l.track_id, l.course_id
      from course_track_courses l
      join course_tracks t on t.id = l.track_id and t.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and t.status = 'active'
     order by l.track_id, l.position, l.course_id`);
  const [meta] = await tx.execute<{ streak_days: number; server_now: string }>(sql`
    select app.course_member_streak() as streak_days,
           to_char(now() at time zone 'utc', ${ISO_MICROSECONDS}) as server_now`);

  const courses: MemberCourseRow[] = courseRows.map((row) => ({
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    coverAssetId: row.cover_asset_id,
    publishedAt: row.published_at,
    locked: row.locked,
  }));
  return {
    serverNow: meta?.server_now ?? new Date().toISOString(),
    streakDays: Math.max(meta?.streak_days ?? 0, 0),
    courses,
    lessons: lessonRows.map(memberLessonRow),
    tracks: memberTrackRows(trackRows, links, new Set(courses.map((course) => course.id))),
  };
}

/**
 * `GET /v1/courses/learn/overview` (08.6, SC 1, SC 4, COURSE-29..34, COURSE-37): the school home as
 * the server decides it for the caller (UI-D-447: one read, one skeleton, nothing derived in the
 * browser). ONE tenant transaction, so every read sees one snapshot and one `now()`; (a), (b), (c)
 * and (g) are `readMemberArea`, the row read the tracks and progress answers share (08.6-04):
 *  (a) the PUBLISHED courses of the tenant with `locked` exactly as the catalogue reads it (the
 *      kernel seam; `'{}'` for staff and with the store off), in catalogue order
 *      (`published_at desc, id desc`), unpaged — the hero and the shelf need the whole order;
 *  (b) `app.course_member_lessons()` — the one member projection over the evaluator (no lane read
 *      of `course_lessons`);
 *  (c) the ACTIVE tracks in the admin order (`created_at desc, id desc`) and their link rows in path
 *      order; each path keeps only the published courses of (a) (08.6-03 planning decision 3);
 *  (d) `app.course_live_cards()` (08.5): the lives whose planned end is still ahead and not
 *      cancelled, with `locked` decided by the projection — never a lane select of `course_lives`,
 *      so the room link cannot be read here (T-08.6-18);
 *  (e) the caller's OWN opt-ins (`course_live_reminders`, own-row select policy plus the explicit
 *      `user_id` predicate, T-08.6-12);
 *  (f) the categories holding a published course with their published-course count, ONE grouped
 *      statement ordered `lower(cat.name), cat.id` (the order is SQL's, never re-sorted here);
 *  (g) `app.course_member_streak()` and the transaction's instant as `serverNow`.
 * The service maps the rows and asks the pure helpers (`heroResume`, `activeTrack`, `courseShelf`
 * without the hero's course, `nextLiveOf` and `newLessonsOf` against `serverNow` parsed once); it
 * decides no lock and no date itself. A section with no data is an ABSENT key (08.6-03 planning
 * decision 1). The route takes no body and no query (T-08.6-05). The log line carries ids, counts
 * and the hero state only (T-05-06).
 */
export async function getLearnOverview(ctx: RequestContext): Promise<LearnOverview> {
  const read = await withTenantTx(ctx, async (tx) => {
    const area = await readMemberArea(tx, ctx);
    // D-444 / COURSE-32: the 08.5 live projection, upcoming only (ended and cancelled lives are
    // never the answer; `nextLiveOf` re-decides the status on the same instant).
    const lives = await tx.execute<MemberLiveSqlRow>(sql`
      select x.live_id as id, x.title, x.cover_asset_id, x.duration_min, x.locked,
             to_char(x.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
             to_char(x.cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at
        from app.course_live_cards() x
       where x.cancelled_at is null
         and ${LIVE_END_MS} > now()
       order by x.starts_at asc, x.live_id asc`);
    const reminders = await tx.execute<{ live_id: string }>(sql`
      select r.live_id
        from course_live_reminders r
       where r.tenant_id = ${ctx.tenantId}::uuid
         and r.user_id = ${ctx.userId}::uuid`);
    // COURSE-34: one statement, the categories holding a published course, SQL's order.
    const categories = await tx.execute<CategoryTileSqlRow>(sql`
      select cat.id, cat.name, cat.cover_asset_id, count(c.id)::int as count
        from course_categories cat
        join courses c
          on c.category_id = cat.id
         and c.tenant_id = cat.tenant_id
         and c.status = 'published'
       where cat.tenant_id = ${ctx.tenantId}::uuid
       group by cat.id
       order by lower(cat.name), cat.id`);
    return { ...area, lives, reminders, categories };
  });
  const { streakDays, serverNow, courses, lessons, tracks } = read;

  const hero = heroResume(courses, lessons);
  const track = activeTrack(tracks, courses, lessons);
  const trackRow = track ? (tracks.find((row) => row.id === track.id) ?? null) : null;
  const shelf = courseShelf(courses, lessons, trackRow, hero?.courseId ?? null);
  // The overview's ONE instant: `serverNow` (the transaction's `now()`) parsed once.
  const now = new Date(serverNow);
  const live = nextLiveOf(
    read.lives.map(
      (row): MemberLiveCardRow => ({
        id: row.id,
        title: row.title,
        coverAssetId: row.cover_asset_id,
        startsAt: row.starts_at,
        durationMin: row.duration_min,
        cancelledAt: row.cancelled_at,
        locked: row.locked,
      }),
    ),
    now,
    new Set(read.reminders.map((row) => row.live_id)),
  );
  const newLessons = newLessonsOf(courses, lessons, now);
  const categories = read.categories.map(
    (row): LearnCategoryTile => ({
      id: row.id,
      name: row.name,
      count: row.count,
      coverAssetId: row.cover_asset_id,
    }),
  );

  log.info(
    {
      event: 'courses.learn_overview',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      hero: hero?.state ?? null,
      courses: courses.length,
      lessons: lessons.length,
      shelf: shelf.length,
      trackId: track?.id ?? null,
      liveId: live?.id ?? null,
      newLessons: newLessons.length,
      categories: categories.length,
    },
    'member overview read',
  );

  // 08.6-03 planning decision 1: a section with no data is an ABSENT key, never an empty value.
  return {
    serverNow,
    streakDays,
    ...(hero ? { hero } : {}),
    ...(shelf.length > 0 ? { shelf } : {}),
    ...(track ? { track } : {}),
    ...(live ? { live } : {}),
    ...(newLessons.length > 0 ? { newLessons } : {}),
    ...(categories.length > 0 ? { categories } : {}),
  };
}

// ── The member's tracks (08.6-04, D-439, D-438, COURSE-35) ──────────────────────────────────────

/**
 * `GET /v1/courses/learn/tracks` (08.6, D-439, COURSE-35): the tenant's ACTIVE tracks for the
 * caller, each with its published courses in path order, every course's state and the caller's
 * progress through it. ONE tenant transaction over `readMemberArea` (the overview's own rows), then
 * the pure `trackStates`, whose `mine` / `suggested` come from the same `activeTrack` as the
 * overview's "Sua trilha" (D-438). A draft or archived course and an archived track are absent; a
 * track left with no published course is absent; with none the answer is `{ tracks: [] }` (08.6-04
 * planning decision 2). The route takes no body and no query (T-08.6-05). The log line carries ids
 * and counts only (T-05-06).
 */
export async function listLearnTracks(ctx: RequestContext): Promise<LearnTracks> {
  const { courses, lessons, tracks } = await withTenantTx(ctx, (tx) => readMemberArea(tx, ctx));
  const views = trackStates(tracks, courses, lessons);

  log.info(
    {
      event: 'courses.learn_tracks',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      tracks: views.length,
      mineTrackId: views.find((view) => view.mine)?.id ?? null,
      suggestedTrackId: views.find((view) => view.suggested)?.id ?? null,
    },
    'member tracks read',
  );

  return { tracks: views };
}

// ── Meu progresso (08.6-04, D-442, COURSE-36, COURSE-38) ────────────────────────────────────────

/**
 * `GET /v1/courses/learn/progress` (08.6, D-442, COURSE-36, COURSE-38): the caller's own numbers.
 * ONE tenant transaction over `readMemberArea` (the overview's own rows, so the ring, the stats and
 * the hero never disagree), then the pure `overallStats` (lessons done and total, the ring's
 * percent, the seconds of the completed lessons' ready videos — a completion by the button counts
 * the full duration and nothing accumulates watched time, D-442 — and the complete courses) and
 * `progressCourses` (the started courses, last activity first), beside the SQL streak. Every number
 * comes from server-stamped rows of the caller alone (`app.user_id()`, T-08.6-22); the route takes
 * no body and no query (T-08.6-05). An `admin_tenant` (the `?ver=aluno` preview) holds no rows
 * (D-422), so it reads zeros, `courses: []` and a 0 streak. The log line carries counts only.
 */
export async function getLearnProgress(ctx: RequestContext): Promise<LearnMyProgress> {
  const { courses, lessons, streakDays } = await withTenantTx(ctx, (tx) => readMemberArea(tx, ctx));
  const stats = overallStats(courses, lessons);
  const started = progressCourses(courses, lessons);

  log.info(
    {
      event: 'courses.learn_progress',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      streakDays,
      lessonsDone: stats.lessonsDone,
      lessonsTotal: stats.lessonsTotal,
      coursesDone: stats.coursesDone,
      courses: started.length,
    },
    'member progress read',
  );

  return { streakDays, ...stats, courses: started };
}
