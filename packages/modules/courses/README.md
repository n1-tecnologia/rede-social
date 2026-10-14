# @rede-social/module-courses

The tenant's school (Phase 08.3, COURSE-01..15): courses the `admin_tenant` authors — title, tagline,
description, category, level, cover, instructor, "o que você vai dominar", optional certificate hours
— with ordered modules and ordered lessons whose videos ride the existing direct-to-provider media
pipeline as `lesson`-purpose assets (D-409), categories, tracks and lives. A course (or a live) is opened by
zero or more store products; an entitlement to any of them opens it, no link means open to every
member. Since 08.4 the links belong to the store and are written only by the product form (D-418,
reversing D-404's write path); this module reads them for the read-only `products` of its details. Only the course has a publication state, `draft → published → archived` with unpublish
back to `draft`, and publishing is refused while any lesson's video is not ready (D-413). The member
side (catalogue, player, progress) is NOT built here; its data model is: the published-or-admin
course read, the restrictive lesson gate with `is_free`, and the own-or-admin progress ledger are
RLS policies covered by pgTAP from day one. With `courses` off for a tenant, nothing changes for
anyone.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `coursesModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `coursesRoutes` and the service functions (`listCourses`, `createCourse`, `getCourse`, `updateCourse`, `setCourseStatus`, `createModule`, `updateModule`, `deleteModule`, `reorderModules`, `createLesson`, `getLesson`, `updateLesson`, `deleteLesson`, `reorderLessons`, `replaceMaterials`, `materialUrl`, `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `listTracks`, `createTrack`, `getTrack`, `updateTrack`, `setTrackStatus`, `replaceTrackCourses`, `listLives`, `createLive`, `getLive`, `updateLive`, `cancelLive`, `listLessonsForPicker`) |
| `./ui` | `CourseRow`, `TrackRow`, `LiveRow`, `RowSkeleton` — props-only list rows and the row skeleton (08.3-06); `CategoryPickerSheet` — the course form's single-select category sheet (08.3-07); `ReorderList`, `ModuleCard`, `LessonRow`, `PublishBlockedNotice` — the curriculum editor's parts (08.3-08); `CoursePickerSheet` — the track form's checklist of published courses (08.3-10); `LessonPickerSheet` — the live form's single-select replay picker grouped by course (08.3-11); every word arrives from the host |
| `./db` | The nine Drizzle tables `courseCategories`, `courses`, `courseModules`, `courseLessons`, `courseLessonMaterials`, `courseLessonProgress`, `courseTracks`, `courseTrackCourses`, `courseLives` with their RLS policies |

Main contract names (`./contracts`): `courseInputSchema`, `coursePatchSchema`,
`courseStatusBodySchema` (`COURSE_STATUSES`), `courseDetailSchema` (with the derived `moduleCount`,
`lessonCount`, `durationSeconds`, `hasUnreadyVideo`, `unreadyLessonIds`), `courseProductSchema`,
`courseListQuerySchema` (`COURSE_FILTERS`, `COURSE_PAGE_SIZE`, `COURSE_MAX_PAGE_SIZE`,
`COURSE_MAX_CURSOR_LENGTH`), `courseRowSchema`, `coursePageSchema`, `categoryInputSchema`,
`categoryPatchSchema`, `categorySchema`, `categoryListSchema`,
`moduleInputSchema`, `modulePatchSchema`, `moduleViewSchema`, `moduleListSchema`,
`lessonInputSchema`, `lessonPatchSchema`, `lessonViewSchema` (`LESSON_VIDEO_STATUSES`),
`lessonListSchema`, `lessonDetailSchema` (the view plus `materials`, `module` and `course.hasProducts`),
the whole-order body factory `reorderIdsSchema(max)` with `reorderModulesSchema`,
`reorderLessonsSchema` and `COURSE_MAX_ORDER` (200), the materials `materialsBodySchema`,
`materialSchema`, `MATERIAL_KINDS` and the pure `materialKind(mime)` (`pdf | sheet | slides | image |
other`), `materialUrlSchema` and `MATERIAL_URL_TTL_SECONDS` (600), the tracks (08.3-10, D-415)
`trackInputSchema`, `trackPatchSchema`, `trackStatusBodySchema` (`TRACK_STATUSES`),
`trackListQuerySchema` (`TRACK_FILTERS`), `trackRowSchema`, `trackPageSchema`, `trackCourseSchema`,
`trackDetailSchema` and the membership-and-order body `reorderTrackCoursesSchema` (`[]` allowed),
the lives (08.3-11, D-416) `liveInputSchema`, `livePatchSchema`, `liveListQuerySchema` (`LIVE_FILTERS`),
`liveRowSchema`, `livePageSchema`, `liveDetailSchema` (`LIVE_STATUSES`, `liveReplaySchema`), the pure
`liveStatusAt(live, now)` (`scheduled | live | recorded | cancelled` — the clock's answer, never a
column), `LIVE_MAX_URL` (2048), the replay picker's `lessonPickerListSchema` and `LESSON_PICKER_MAX` (200),
the level enum `COURSE_LEVELS`,
the caps `COURSE_MAX_TITLE`, `COURSE_MAX_TAGLINE`, `COURSE_MAX_DESCRIPTION`, `COURSE_MAX_OUTCOMES`,
`COURSE_MAX_OUTCOME`, `COURSE_MAX_HOURS`, `MODULE_MAX_TITLE`,
`MODULE_MAX_SUMMARY`, `LESSON_MAX_TITLE`, `LESSON_MAX_DESCRIPTION`, `LESSON_MAX_MATERIALS`,
`CATEGORY_MAX_NAME`, `TRACK_MAX_TITLE`, `TRACK_MAX_SUBTITLE`, `TRACK_MAX_AUDIENCE`,
`TRACK_MAX_DESCRIPTION`, `LIVE_MAX_TITLE`, `LIVE_MAX_DESCRIPTION`, `LIVE_MIN_DURATION`,
`LIVE_MAX_DURATION`, the permission names `COURSE_PERMISSIONS` (`courses.manage`), and the refusal
vocabulary `COURSE_ISSUES` / `COURSE_ISSUE_SET`.

Routes (`/v1/courses`), every one behind `requireAuth`, `requireModule('courses')` AND
`requirePermission('courses.manage')` (no member route exists in 08.3; later plans append rows):

| Route | Who | What |
|---|---|---|
| `GET /v1/courses/categories` | `courses.manage` | the tenant's categories ordered `lower(name), id`, each with `courseCount` (non-archived courses) — D-411 |
| `POST /v1/courses/categories` | `courses.manage` | create a category (name 1..60 after trim, optional ready `cover` image); `409 category_exists` when another category of the tenant has the name ignoring case; `400 cover_invalid` by name for anything that is not a ready cover of this tenant |
| `PATCH /v1/courses/categories/{categoryId}` | `courses.manage` | edit name and/or cover under the row lock; `409 category_exists` against the OTHER categories; `400 patch_empty`; unknown or foreign id is the bare 404 |
| `DELETE /v1/courses/categories/{categoryId}` | `courses.manage` | 204 for an empty category; `409 { courses: 'category_in_use', courseCount }` while any course — archived included — references it (the FK `on delete restrict` backs it); unknown or foreign id is the bare 404 |
| `GET /v1/courses` | `courses.manage` | the catalogue: `filter=all` (drafts + published, the default) / `draft` / `published` / `archived`, keyset over `(created_at desc, id desc)`, `limit` 1..50 (20), opaque `cursor` (`400 cursor_invalid` when tampered); every row carries `moduleCount`, `lessonCount`, `durationSeconds`, `hasUnreadyVideo`, `categoryName`, `publishedAt` computed with the row |
| `POST /v1/courses` | `courses.manage` | create a `draft` course (no product link: the product form is the only writer, D-418; the old link key is a 400) |
| `GET /v1/courses/{courseId}` | `courses.manage` | the manager's detail: category, `products` (the store products that open it, newest first, with their `status`; read-only, written by the product form), live modules with their live lessons, video status and duration per lesson, the derived aggregates |
| `PATCH /v1/courses/{courseId}` | `courses.manage` | edit any subset of the course fields under the row lock; no product link (D-418: the old link key alone is `400 patch_empty`, beside a field a `details.issues` list); `400 cover_invalid` / `photo_invalid` / `category_invalid` / `patch_empty`; unknown or foreign id is the bare 404 |
| `POST /v1/courses/{courseId}/modules` | `courses.manage` | add a module at the next position; the first module never `requiresPrevious` (D-406) |
| `POST /v1/courses/modules/{moduleId}/lessons` | `courses.manage` | add a lesson at the next position of its module; `videoAssetId` is a `lesson` video asset of this tenant in any status (`400 video_invalid` by name for an unknown or foreign id, `video_in_use` for one already linked) |
| `PUT /v1/courses/{courseId}/status` | `courses.manage` | `draft` / `published` / `archived`, idempotent; publishing answers `409 { courses: 'video_not_ready', lessonIds }` while a live lesson's video is missing from the lane or not ready (a soft-deleted lesson is ignored, a lesson without video never blocks, an empty course may publish); out of `archived` is `409 status_invalid`; archiving never consults readiness |
| `PATCH /v1/courses/modules/{moduleId}` | `courses.manage` | edit `title`, `summary`, `requiresPrevious` under the row lock; `requiresPrevious` is forced `false` on the first live module of the course (D-406); `400 patch_empty`; unknown, foreign or removed id is the bare 404 |
| `DELETE /v1/courses/modules/{moduleId}` | `courses.manage` | SOFT delete (`deleted_at`), 204; its lessons' rows and every progress row stay; a second call is the bare 404; the remaining modules keep a gap in `position` until the next reorder |
| `PUT /v1/courses/{courseId}/modules/order` | `courses.manage` | the whole order of the course's live modules as one permutation (D-414): the course row is locked first (bare 404), the live set `for update`, any set mismatch is `409 { courses: 'order_stale' }`, ONE `update … from unnest(...) with ordinality` touching only changed rows (the same order twice writes nothing); `ids` 1..200, every id once (a duplicate is 400); answers `{ items }` in the new order |
| `GET /v1/courses/lessons/{lessonId}` | `courses.manage` | the lesson detail: the view (video status and duration from the asset row), `materials` by `position, id` (each with `filename`, `mime`, `kind`, `bytes`), `module { id, title, position }`, `course { id, title, status, hasProducts }`; unknown, foreign or removed id is the bare 404 |
| `PATCH /v1/courses/lessons/{lessonId}` | `courses.manage` | edit `title`, `description`, `isFree`, `videoAssetId` (null detaches; a `lesson` video asset of this tenant in any status attaches — `400 video_invalid` by name otherwise; one on ANOTHER live lesson is `400 video_in_use`, the partial unique index arbitrates a race); nothing about the video is typed (D-409) |
| `DELETE /v1/courses/lessons/{lessonId}` | `courses.manage` | SOFT delete (`deleted_at`), 204; progress rows and material rows stay; the video asset is freed for another lesson; a second call is the bare 404 |
| `PUT /v1/courses/modules/{moduleId}/lessons/order` | `courses.manage` | the whole order of the module's live lessons, the same statement and rules as the modules' (`order_stale`, idempotent replay); a module with no live lesson and a non-empty body is `order_stale` |
| `PUT /v1/courses/lessons/{lessonId}/materials` | `courses.manage` | REPLACES the lesson's ordered material set with `assetIds` (≤ 10, every id once — `400 too_many_materials`, a duplicate is 400) under the lesson row lock: every id a READY `attachment` file of this tenant (`400 material_invalid` for a cover, a pending or rejected upload; an unknown or foreign id is the bare 404); positions follow body order; a re-sent set keeps its rows; `[]` clears (D-410) |
| `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` | `courses.manage` | `{ url, expiresAt }` minted per request by `signReadFor(mediaOriginalKey(tenantId, assetId), 600)` after `assertTenantKey`, answered `Cache-Control: no-store`, never logged; a material of another lesson, tenant, a removed lesson or asset, or an unknown id is the bare 404 (T-08.3-06) |
| `GET /v1/courses/tracks` | `courses.manage` | the Trilhas tab: `filter=active` (the default) / `archived`, keyset over `(created_at desc, id desc)`, `limit` 1..50 (20), opaque `cursor`; `courseCount` counts ONLY the linked courses that are `published` right now (D-415) |
| `POST /v1/courses/tracks` | `courses.manage` | create an `active` track (title 1..120, subtitle ≤ 160, audience ≤ 60, description ≤ 2 000, optional ready `cover`) with no course yet; a track has no lessons, hours or certificate of its own (D-415) |
| `GET /v1/courses/tracks/{trackId}` | `courses.manage` | the admin detail: the row and EVERY linked course by `position, id` with its current `status` (the form marks a no-longer-published one); `courseCount` is the published ones only; unknown or foreign id is the bare 404 |
| `PATCH /v1/courses/tracks/{trackId}` | `courses.manage` | edit any subset of the fields under the row lock; the course list never travels here; `400 cover_invalid` / `patch_empty`; unknown or foreign id is the bare 404 |
| `PUT /v1/courses/tracks/{trackId}/status` | `courses.manage` | `active` / `archived`, idempotent in both directions (archive never deletes; `archived → active` is allowed for tracks); the same status answers the unchanged detail |
| `PUT /v1/courses/tracks/{trackId}/order` | `courses.manage` | the ONE write path of membership AND order (D-414, A8): `ids` REPLACES the link set in body order under the track row lock — absent ids unlinked, present ones linked, positions 1..N; every id a PUBLISHED course of this tenant (`400 course_invalid` for a draft, an archived, an unknown, a foreign or a non-uuid id, by name); `[]` clears; a duplicate is 400; the same list twice keeps the rows (`created_at` untouched, zero renumbered); a course may sit in several tracks |
| `GET /v1/courses/lives` | `courses.manage` | the Lives tab: `filter=upcoming` (the default: every live whose END is still ahead, soonest first on `(starts_at asc, id asc)`) / `past` (ended, latest first), `limit` 1..50 (20), opaque `cursor`; a cancelled live stays in its time bucket; each row's `status` is DERIVED at answer time by `liveStatusAt` — the table has no status column (D-416) |
| `POST /v1/courses/lives` | `courses.manage` | schedule a live (title 1..120, description ≤ 2 000, optional ready `cover`, `startsAt` an ISO instant with offset, `durationMin` 5..600, an `https` `externalUrl` — `400 url_invalid` for `http:`, `javascript:`, `ftp:` or a bare host; no product link, D-418); a start in the past is accepted and reads `recorded`; nothing streams in the app and nobody is notified |
| `GET /v1/courses/lives/{liveId}` | `courses.manage` | the detail: the fields, the derived `status`, `cancelledAt`, `products` (the store products that open it, read-only), `replayLesson { id, title, courseTitle }` or null; unknown or foreign id is the bare 404 |
| `PATCH /v1/courses/lives/{liveId}` | `courses.manage` | edit any subset under the row lock (no product link, D-418); `replayLessonId` (null clears) must be a LIVE lesson of this tenant (`400 lesson_invalid` by name) and is accepted only once the live has ENDED (`409 replay_too_early`); a cancelled live refuses the whole patch (`409 live_cancelled`); the same patch twice leaves the row |
| `POST /v1/courses/lives/{liveId}/cancel` | `courses.manage` | sets `cancelled_at` ONCE (`coalesce(cancelled_at, now())` under the row lock) and answers the detail as `cancelled`; a second or a concurrent call answers 200 with the SAME instant; never a delete |
| `GET /v1/courses/lessons` | `courses.manage` | the replay picker's read: the tenant's live lessons under live modules with their course (`{ id, title, courseId, courseTitle, videoStatus }`), course newest first, then module and lesson position, capped at 200 |

The products that open a course or a live are READ from the store's link tables
(`store_product_courses`, `store_product_lives`) joined to `public.store_products` by SQL inside this
module's own statements; this module writes no link (D-418) and the courses package imports nothing
from the store package (MOD-02). Archiving or unpublishing a course
never deletes a module, a lesson, a link or a progress row, and no route hard-deletes a course:
archive is the only end state (D-413, the communities posture). Modules and lessons are never
hard-deleted either: `DELETE` sets `deleted_at`, the admin lists read `deleted_at is null`, and every
progress row referencing a removed lesson stays (D-408). A lesson's video is only ever a
direct-upload `lesson` asset: the contract has no URL and no typed duration (D-409).

Materials (D-410) are `attachment` assets of the kernel media pipeline; a material is opened only
through the ten-minute signed URL the module mints with the kernel's `signReadFor` after
`assertTenantKey` on the `mediaOriginalKey` of the CALLER's tenant, so a foreign asset id can never
be signed from another tenant's lane.

SQL the module relies on:

- the kernel course-gate seam declared by `supabase/migrations/*_course_gate_seam.sql` (see
  `packages/core/db/README.md`): `app.course_locked_ids()`, `app.course_locked_ids_for(uuid)`,
  `app.live_locked_ids()`, `app.live_locked_ids_for(uuid)`. The restrictive policy
  `course_lessons_course_gate` (`app.tenant_role() = 'admin_tenant' or is_free or course_id <> all
  (coalesce((select app.course_locked_ids()), '{}'::uuid[]))`) is built from `LOCKED_COURSE_IDS` of
  `@rede-social/core/db/course-gate`. The restrictive policy `course_lives_live_gate`
  (`supabase/migrations/*_courses_live_gate.sql`, 08.3 review WR-01) mirrors it on `course_lives`
  (`app.tenant_role() = 'admin_tenant' or id <> all (coalesce((select app.live_locked_ids()),
  '{}'::uuid[]))`), so a locked live's `external_url` never reaches a member lane. The STORE module implements the four bodies, since 08.4
  over its own link tables (`supabase/migrations/*_store_course_links_functions.sql`; a course or
  live linked to ≥ 1 product for which the user holds no active entitlement is locked; staff never
  are; store off → nothing locked);
- the store's tables `store_product_courses`, `store_product_lives` and `store_products`, READ by
  SQL table name for the course and live detail `products` and the lesson `hasProducts` (08.4,
  D-418). The 08.3 link tables `course_products` / `course_live_products` and their hand FKs to
  `store_products` in `*_courses_functions.sql` are no longer read or written; a later 08.4
  migration drops them.

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`courses` in `tenant_modules`. No `requires` (D-405: a school without the store still teaches; every
course is open and stored product links stay dormant until the store is on). Off by default: not in
`REAL_TENANT_DEFAULT_MODULES`, and no migration backfills a row (a missing row reads as disabled,
COURSE-01). The SQL gate reads the tenant's `store` row itself, so content gating and the routes
agree (the API flag cache may lag by up to 30 s).

## Kernel dependencies

- `@rede-social/core/db/course-gate`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/media/keys` (`mediaOriginalKey`, `assertTenantKey`)
- `@rede-social/core/server/media/storage` (`signReadFor`)
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- None in 08.3 (D-401): the manifest declares no `nav`, so members see no tab and no icon. The
  admin enters through the Cursos row in Configurações → Administração (plan 06), which opens the
  `/cursos` hub. The member phase adds a BottomNav tab and the Reels demotion rule in
  `packages/core/ui/nav.ts`.

## Jobs

- None.
- Sweep functions: none.

## Reuse

UI (`./ui`, since 08.3-06): props only, no words of their own, no other module imported; the hub, track and live rows, the row skeleton and (08.3-07) the single-select `CategoryPickerSheet`. The course and live forms show the linking products as a read-only line in `apps/web` (D-418: the product form in the Loja is the only place a link is written; the courses module never imports the store). The curriculum editor's parts (`ReorderList`, `ModuleCard`, `LessonRow`, `PublishBlockedNotice`, 08.3-08) and the track form's `CoursePickerSheet` (a props-only checklist over `BottomSheet`, 08.3-10) followed; the live form's single-select `LessonPickerSheet` grouped by course (08.3-11) completes the set.

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: a request id and a per-request
logger, an `onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `courses.manage`), the kernel migration
`*_course_gate_seam.sql` applied before this module's migrations, and
`.route('/v1/courses', coursesRoutes)`. The routes carry their own `requireAuth`,
`requireModule('courses')` and `requirePermission` chain. A project without the store keeps the
kernel stubs (every course and live open), never applies the store's migrations, and must replace
the three read-only product reads of the service (the course and live detail `products`, the lesson
`hasProducts`), which name the store's tables by SQL: the accepted debt of D-418.
