import { LOCKED_COURSE_IDS } from '@rede-social/core/db/course-gate';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { assertTenantKey, mediaOriginalKey } from '@rede-social/core/server/media/keys';
import { signReadFor } from '@rede-social/core/server/media/storage';
import { sql } from 'drizzle-orm';
import type {
  CourseLevel,
  LearnCourse,
  LearnLesson,
  LearnMaterial,
  LearnNeighbour,
  LearnOutlineLesson,
  LearnOutlineModule,
  LearnProgress,
  LessonLockReason,
  MaterialUrl,
  ModuleLockReason,
  ProgressBody,
  ProgressResult,
} from '../contracts/index';
import {
  LESSON_COMPLETION_RATIO,
  MATERIAL_URL_TTL_SECONDS,
  materialKind,
} from '../contracts/index';
import { videoStatusOf } from './service';

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
