import { LOCKED_COURSE_IDS, LOCKED_LIVE_IDS } from '@rede-social/core/db/course-gate';
import { mediaAssets, tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** This tenant's rows: the read predicate of the catalogue. */
const SAME_TENANT = sql`tenant_id = app.tenant_id()`;

/** This tenant's rows, and only for the `admin_tenant` claim: the write predicate (CR-01). */
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

/**
 * The three write policies of an admin-written table: only the `admin_tenant` claim INSERTs,
 * UPDATEs or DELETEs. A member or `support_tenant` write matches no policy: an insert raises 42501,
 * an update or delete touches 0 rows.
 */
const adminWritePolicies = (table: string) => [
  pgPolicy(`${table}_insert_admin`, {
    for: 'insert',
    to: authenticatedRole,
    withCheck: TENANT_ADMIN,
  }),
  pgPolicy(`${table}_update_admin`, {
    for: 'update',
    to: authenticatedRole,
    using: TENANT_ADMIN,
    withCheck: TENANT_ADMIN,
  }),
  pgPolicy(`${table}_delete_admin`, { for: 'delete', to: authenticatedRole, using: TENANT_ADMIN }),
];

/**
 * The four policies of a tenant-read, admin-write table (the store's helper, module-local: the
 * store does not export it, MOD-02): every lane of the tenant SELECTs, and only the `admin_tenant`
 * claim writes.
 */
const tenantReadAdminWritePolicies = (table: string) => [
  pgPolicy(`${table}_select_tenant`, { for: 'select', to: authenticatedRole, using: SAME_TENANT }),
  ...adminWritePolicies(table),
];

/**
 * The ONE read predicate of the progress ledger: this tenant, and the caller's own rows, or every
 * row of the tenant for an `admin_tenant` claim.
 */
const OWN_OR_ADMIN = sql`tenant_id = app.tenant_id() and (user_id = app.user_id() or app.tenant_role() = 'admin_tenant')`;

/**
 * The WRITE predicate of the progress ledger (08.5, COURSE-21, D-422, D-429; closes T-08.3-09 in
 * the database): this tenant, the caller's own row, never the `admin_tenant` claim ("Ver como
 * aluno" writes no progress), and only for a lesson the caller may OPEN — the one access answer
 * `app.course_lesson_access(lesson_id)` is NULL (the course door: bought or free, sequence met; or
 * the live door, D-433). A purchase-locked or sequence-locked lesson, a removed one and another
 * tenant's lesson (it answers `'missing'`, which also closes the 08.3-01 FK residual: the plain FK
 * would accept a foreign lesson id) are all refused with 42501. A free lesson writes for a
 * non-buyer (D-429). It guards BOTH the insert and the update: PostgreSQL checks the INSERT
 * policies' `WITH CHECK` for every row an `INSERT … ON CONFLICT DO UPDATE` proposes, even when the
 * update path is taken, then the UPDATE `USING` and `WITH CHECK` (RESEARCH Pattern 7), so the
 * member route's upsert is refused in both paths for a lesson the caller cannot open.
 */
const OWN_OPEN_LESSON = sql`tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() is distinct from 'admin_tenant' and app.course_lesson_access(lesson_id) is null`;

/**
 * A child row is visible only while its course is (the course's own select policy applies inside
 * the subquery, so a member lane never reads the modules or lessons of a `draft` course, D-413).
 */
const COURSE_VISIBLE = sql`exists (select 1 from public.courses c where c.id = course_id)`;

/**
 * The courses module's tables (08.3, COURSE-01..15; RESEARCH Pattern 2, the store's naming): the
 * tenant's school as the admin authors it. Nine tables: `course_categories`, `courses`,
 * `course_modules`, `course_lessons`, `course_lesson_materials`, `course_lesson_progress`,
 * `course_tracks`, `course_track_courses`, `course_lives`. Since 08.4 the store owns the course and
 * live links (`store_product_courses` / `store_product_lives`, D-418) and computes the product gate
 * (`app.course_locked_ids*`, `app.live_locked_ids*`, the kernel seam
 * `@rede-social/core/db/course-gate`) from them and its entitlements once per statement, so
 * nothing is derived and nothing drifts.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **No table here names a product.** The courses module never imports the store schema (MOD-02):
 *    the link tables live in the store, and their foreign keys to `courses` / `course_lives` are
 *    hand SQL in the store's `*_store_course_links_functions.sql`. This module only reads the gate
 *    through the kernel seam, which answers `'{}'` when the store is absent or off.
 * 2. **Modules and lessons are soft-deleted (`deleted_at`), never hard-deleted.** Progress rows will
 *    reference lessons (D-408) and lives may point at a replay lesson; the admin's "Remover" sets
 *    `deleted_at` and every list filters it out.
 * 3. **No lesson `type` column, no stored live status, no stored hours.** A lesson is a video lesson
 *    when `video_asset_id` is set and a practice otherwise; a live's `scheduled | live | recorded`
 *    is the clock against `starts_at + duration_min` (`cancelled_at` is the only stored state,
 *    D-416); a course's duration is the sum of its ready videos.
 * 4. **`course_lesson_progress` has NO delete policy** (D-408). It is a member's own record: the
 *    member lane inserts and updates ONLY its own rows (`user_id = app.user_id()`), the admin lane
 *    reads the tenant's, and no tenant lane can remove one. Since 08.5 the member's progress route
 *    writes it and the lock evaluator `app.course_lesson_states` reads it.
 *
 * **Every catalogue table is READ by the tenant and WRITTEN by the `admin_tenant` claim only**
 * (D-403, the store's CR-01 posture): a lane that could rewrite a course or a live could reshape
 * what a paid product opens. `courses_select_published_or_admin` is the member read predicate
 * modeled now for the member phase: a `draft` course is visible to the admin claim only, and its
 * modules, lessons and materials follow it through `COURSE_VISIBLE`. `course_lessons_course_gate`
 * is RESTRICTIVE: it ANDs with the permissive tenant select, so a member of a locked course reads
 * only its `is_free` lessons (D-407) while the admin reads all.
 *
 * `tenant_id` is the FIRST column of every index (pgTAP 040); text columns default `''`, not NULL;
 * status columns are text with a CHECK, never a boolean (SCHEMA-CONVENTIONS §(d).1).
 *
 * Owned by `packages/modules/courses` and picked up by `apps/api/drizzle.config.ts`'s module glob.
 */
export const courseCategories = pgTable(
  'course_categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** NULLABLE (D-411): a `cover` image, or the brand gradient. */
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One name per tenant, ignoring case (P13); the service answers `409 category_exists` first.
    uniqueIndex('course_categories_tenant_name_uq').on(t.tenantId, sql`lower(${t.name})`),
    ...tenantReadAdminWritePolicies('course_categories'),
  ],
).enableRLS();

export const courses = pgTable(
  'courses',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (SCHEMA-CONVENTIONS §(c).1). Stored for auditing, never projected. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    /** `''` rather than NULL: "no tagline" is ONE value. */
    tagline: text().notNull().default(''),
    description: text().notNull().default(''),
    /** Zero or one category (D-411); a category with courses cannot be removed (`restrict`). */
    categoryId: uuid('category_id').references(() => courseCategories.id, { onDelete: 'restrict' }),
    /** `iniciante | intermediario | avancado`, or NULL for "no level". */
    level: text(),
    /** NULLABLE (D-69): a `cover` image, or the brand gradient. */
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    /** D-412: free text, no membership FK. */
    instructorName: text('instructor_name').notNull(),
    instructorPhotoAssetId: uuid('instructor_photo_asset_id').references(() => mediaAssets.id),
    /** "O que você vai dominar": at most 10 bullets (the CHECK below; the contract caps each at 120). */
    outcomes: text().array().notNull().default(sql`'{}'::text[]`),
    /** Optional certificate hours; NULL is "no certificate". */
    certificateHours: integer('certificate_hours'),
    /** `'draft' | 'published' | 'archived'` (D-413): a status column with a CHECK, never a boolean. */
    status: text().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The admin list, newest first. `.nullsFirst()` matches SQL's `order by x desc` (04-03's lesson).
    index('courses_tenant_created_idx').on(
      t.tenantId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // The same list under a status chip.
    index('courses_tenant_status_created_idx').on(
      t.tenantId,
      t.status,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('courses_status_chk', sql`${t.status} in ('draft','published','archived')`),
    check(
      'courses_level_chk',
      sql`${t.level} is null or ${t.level} in ('iniciante','intermediario','avancado')`,
    ),
    check('courses_outcomes_chk', sql`cardinality(${t.outcomes}) <= 10`),
    check(
      'courses_hours_chk',
      sql`${t.certificateHours} is null or ${t.certificateHours} between 0 and 999`,
    ),
    // The member read predicate, modeled now (D-413): a draft is the admin claim's alone.
    pgPolicy('courses_select_published_or_admin', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and (status = 'published' or app.tenant_role() = 'admin_tenant')`,
    }),
    ...adminWritePolicies('courses'),
  ],
).enableRLS();

/** An ordered module inside a course. Soft-deleted (fact 2). */
export const courseModules = pgTable(
  'course_modules',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    summary: text().notNull().default(''),
    /** 1..n among the live modules of the course; the service assigns the next one. */
    position: integer().notNull().default(0),
    /**
     * D-406: "Exige concluir o módulo anterior". Since 08.5 (D-428) it is evaluated by
     * `app.course_lesson_states`: the module stays locked until every live lesson of the previous
     * NON-EMPTY live module is complete; a stale `true` on the first module locks nothing.
     */
    requiresPrevious: boolean('requires_previous').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('course_modules_tenant_course_position_idx')
      .on(t.tenantId, t.courseId, t.position)
      .where(sql`deleted_at is null`),
    // A module is visible while its course is (a member never reads a draft's modules).
    pgPolicy('course_modules_select_tenant', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${SAME_TENANT} and ${COURSE_VISIBLE}`,
    }),
    ...adminWritePolicies('course_modules'),
  ],
).enableRLS();

/** An ordered lesson inside a module. `course_id` is denormalised for the gate predicate. */
export const courseLessons = pgTable(
  'course_lessons',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The module's course, copied at insert so the gate policy needs no join. */
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModules.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text().notNull().default(''),
    /** D-409: a `lesson`-purpose video asset, or NULL for a practice lesson (fact 3). */
    videoAssetId: uuid('video_asset_id').references(() => mediaAssets.id),
    /** D-407: "Aula aberta" — readable by a member of a locked course. */
    isFree: boolean('is_free').notNull().default(false),
    /**
     * D-428 (08.5): "Exige concluir a aula anterior". Evaluated by `app.course_lesson_states`: the
     * lesson stays locked until the previous live lesson in course order (which may sit in the
     * previous module) is complete. Forced off on the first lesson of the course by the service
     * (plan 03); the evaluator's `course_seq > 1` guard makes a stale `true` there harmless. A free
     * lesson ignores it (D-429).
     */
    requiresPrevious: boolean('requires_previous').notNull().default(false),
    position: integer().notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('course_lessons_tenant_module_position_idx')
      .on(t.tenantId, t.moduleId, t.position)
      .where(sql`deleted_at is null`),
    // The publish guard and the gate's lookups: "the lessons of this course".
    index('course_lessons_tenant_course_idx').on(t.tenantId, t.courseId),
    // One video asset per LIVE lesson (P22); a soft-deleted lesson frees it. The service answers
    // `400 video_in_use` before this index can.
    uniqueIndex('course_lessons_tenant_video_uq')
      .on(t.tenantId, t.videoAssetId)
      .where(sql`video_asset_id is not null and deleted_at is null`),
    // A lesson is visible while its course is (a member never reads a draft's lessons).
    pgPolicy('course_lessons_select_tenant', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${SAME_TENANT} and ${COURSE_VISIBLE}`,
    }),
    ...adminWritePolicies('course_lessons'),
    // RESTRICTIVE so it ANDs with the permissive select above (a permissive one would widen access):
    // the admin claim reads every lesson; a member reads a locked course's free lessons only. The
    // kernel seam's coalesce wrapper is mandatory (RESEARCH Pitfall 1).
    pgPolicy('course_lessons_course_gate', {
      as: 'restrictive',
      for: 'select',
      to: authenticatedRole,
      using: sql`app.tenant_role() = 'admin_tenant' or is_free or course_id <> all (${LOCKED_COURSE_IDS})`,
    }),
  ],
).enableRLS();

/** D-410: up to 10 `attachment` assets per lesson, ordered. The cap is the service's (no cross-row CHECK). */
export const courseLessonMaterials = pgTable(
  'course_lesson_materials',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => courseLessons.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    position: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Quick 261016-aqc (08.5 code review WR-01): a detach stamps this instead of removing the row,
     * so the asset stays governed by `app.course_asset_hidden` for good (any material row of the
     * tenant, live or not, governs its asset). Every reader filters `deleted_at is null`, and a
     * re-attach revives the same row through `course_lesson_materials_uq`. The indexes and the
     * policies are deliberately unchanged: the select policy must keep seeing a soft-deleted row so
     * `on conflict … do update` can revive it under RLS.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('course_lesson_materials_uq').on(t.tenantId, t.lessonId, t.assetId),
    // 08.5 (COURSE-20): the asset gate (`app.course_asset_hidden`) looks a material up BY ASSET;
    // the unique index above leads with the lesson and cannot serve it.
    index('course_lesson_materials_tenant_asset_idx').on(t.tenantId, t.assetId),
    // A material follows its lesson: the lesson's own policies (tenant, draft, gate) apply inside.
    pgPolicy('course_lesson_materials_select_lesson', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and exists (select 1 from public.course_lessons l where l.id = lesson_id)`,
    }),
    ...adminWritePolicies('course_lesson_materials'),
  ],
).enableRLS();

/**
 * D-408 / COURSE-09: a member's progress on a lesson, keyed by the membership (`tenant_id`,
 * `user_id`) and the lesson. Modeled in 08.3; from 08.5 the sequence lock reads it
 * (`app.course_lesson_states`, D-428) and the member's progress route writes it. The PK is the
 * arbiter (P37): the member phase writes with `on conflict … do update`.
 */
export const courseLessonProgress = pgTable(
  'course_lesson_progress',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => courseLessons.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastPositionSeconds: integer('last_position_seconds').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.lessonId] }),
    // "Continue watching" (the member area): a member's rows, most recent first.
    index('course_lesson_progress_tenant_user_updated_idx').on(
      t.tenantId,
      t.userId,
      t.updatedAt.desc().nullsFirst(),
    ),
    check('course_lesson_progress_position_chk', sql`${t.lastPositionSeconds} >= 0`),
    pgPolicy('course_lesson_progress_select_own_or_admin', {
      for: 'select',
      to: authenticatedRole,
      using: OWN_OR_ADMIN,
    }),
    // 08.5 (COURSE-21): both write checks are `OWN_OPEN_LESSON` — own row, never the admin claim,
    // and only a lesson the caller may open. The update's `using` stays own-row.
    pgPolicy('course_lesson_progress_insert_own', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: OWN_OPEN_LESSON,
    }),
    pgPolicy('course_lesson_progress_update_own', {
      for: 'update',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
      withCheck: OWN_OPEN_LESSON,
    }),
    // Fact 4: NO delete policy. A member's record is never removed by any tenant lane (D-408).
  ],
).enableRLS();

/** D-415: an ordered path over published courses. Archived, never deleted. */
export const courseTracks = pgTable(
  'course_tracks',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    subtitle: text().notNull().default(''),
    /** "Para quem está começando". */
    audience: text().notNull().default(''),
    description: text().notNull().default(''),
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    /** `'active' | 'archived'`. */
    status: text().notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('course_tracks_tenant_status_created_idx').on(
      t.tenantId,
      t.status,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('course_tracks_status_chk', sql`${t.status} in ('active','archived')`),
    ...tenantReadAdminWritePolicies('course_tracks'),
  ],
).enableRLS();

/** The ordered courses of a track. An unpublished course drops out at READ time; the row stays (D-415). */
export const courseTrackCourses = pgTable(
  'course_track_courses',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => courseTracks.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('course_track_courses_uq').on(t.tenantId, t.trackId, t.courseId),
    ...tenantReadAdminWritePolicies('course_track_courses'),
  ],
).enableRLS();

/**
 * D-416: an agenda entry whose state is derived from the clock. No streaming, no status column:
 * `cancelled_at` is the only stored state, and a cancel never deletes.
 */
export const courseLives = pgTable(
  'course_lives',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    description: text().notNull().default(''),
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    /** A UTC instant. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** Planned duration in minutes, 5..600. */
    durationMin: integer('duration_min').notNull(),
    /** Any `https` URL: YouTube, Zoom, Meet, anything. */
    externalUrl: text('external_url').notNull(),
    /** Set by the admin after the live; a lesson of this tenant that holds the recording. */
    replayLessonId: uuid('replay_lesson_id').references(() => courseLessons.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The agenda: `starts_at asc, id asc` (an ascending order needs no `.nullsFirst()`).
    index('course_lives_tenant_starts_idx').on(t.tenantId, t.startsAt, t.id),
    check('course_lives_duration_chk', sql`${t.durationMin} between 5 and 600`),
    ...tenantReadAdminWritePolicies('course_lives'),
    // WR-01 (08.3 review), the mirror of `course_lessons_course_gate`: RESTRICTIVE, so it ANDs with
    // the permissive tenant select. A gated live's payload is `external_url` (the paid room link)
    // on the row itself, so a member lane locked out by `app.live_locked_ids()` reads no row at
    // all; the admin claim reads every live. The kernel seam's coalesce wrapper is mandatory
    // (RESEARCH Pitfall 1).
    pgPolicy('course_lives_live_gate', {
      as: 'restrictive',
      for: 'select',
      to: authenticatedRole,
      using: sql`app.tenant_role() = 'admin_tenant' or id <> all (${LOCKED_LIVE_IDS})`,
    }),
  ],
).enableRLS();

/**
 * D-444 / COURSE-39 (08.6): a member's opt-in to one live's reminder, keyed by the membership
 * (`tenant_id`, `user_id`) and the live. The row IS the fact: "Ativar lembrete" inserts it,
 * "Lembrete ativado" off deletes it, so there is NO update policy (an update matches no row).
 *
 * D-446, the RLS backstop: the member route refuses first (plan 08.6-05: `403 live_locked`,
 * `409 reminder_closed`), and the insert check refuses here too — only the caller's own row of
 * this tenant, never under the `admin_tenant` claim (D-422: the preview writes nothing), and never
 * for a live in the caller's locked set (the kernel seam in its mandatory coalesce form).
 *
 * The opt-ins are PRIVATE (PR-4, T-08.6-12): every policy is own-row, with no staff branch, so no
 * member and no support agent can list who opted into which paid live. That also hides every row
 * from the notifications worker's zero user (R-Pitfall 2), so the worker reads its recipients
 * through a tenant-pinned definer (plan 08.6-05), never through a lane select. The
 * `(tenant_id, live_id)` index serves that fire-time read.
 */
export const courseLiveReminders = pgTable(
  'course_live_reminders',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    liveId: uuid('live_id')
      .notNull()
      .references(() => courseLives.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.liveId] }),
    // The fire-time recipients read (plan 08.6-05): tenant first (pgTAP 040).
    index('course_live_reminders_tenant_live_idx').on(t.tenantId, t.liveId),
    pgPolicy('course_live_reminders_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
    pgPolicy('course_live_reminders_insert_own', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() is distinct from 'admin_tenant' and live_id <> all (${LOCKED_LIVE_IDS})`,
    }),
    pgPolicy('course_live_reminders_delete_own', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
    // No update policy: on/off is insert/delete (D-444).
  ],
).enableRLS();
