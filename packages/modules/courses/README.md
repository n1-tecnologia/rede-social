# @rede-social/module-courses

The tenant's school (Phase 08.3, COURSE-01..15): courses the `admin_tenant` authors — title, tagline,
description, category, level, cover, instructor, "o que você vai dominar", optional certificate hours
— with ordered modules and ordered lessons whose videos ride the existing direct-to-provider media
pipeline as `lesson`-purpose assets (D-409), categories, tracks and lives. A course (or a live) is opened by
zero or more store products; an entitlement to any of them opens it, no link means open to every
member. Since 08.4 the links belong to the store and are written only by the product form (D-418,
reversing D-404's write path); this module reads them for the read-only `products` of its details. Only the course has a publication state, `draft → published → archived` with unpublish
back to `draft`, and publishing is refused while any lesson's video is not ready (D-413). Since
Phase 08.5 the member side is built here too: a member reads a published course's curriculum by
title (locked lessons included), opens the lessons the server lets them open, writes their own
progress and opens the materials of an open lesson (see "Member routes (08.5)" below). Every lock
decision is the database's: one evaluator and one access answer, asked by the routes, the progress
RLS and the kernel media gate. With `courses` off for a tenant, nothing changes for anyone.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `coursesModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `coursesRoutes` and the service functions (`listCourses`, `createCourse`, `getCourse`, `updateCourse`, `setCourseStatus`, `createModule`, `updateModule`, `deleteModule`, `reorderModules`, `createLesson`, `getLesson`, `updateLesson`, `deleteLesson`, `reorderLessons`, `replaceMaterials`, `materialUrl`, `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `listTracks`, `createTrack`, `getTrack`, `updateTrack`, `setTrackStatus`, `replaceTrackCourses`, `listLives`, `createLive`, `getLive`, `updateLive`, `cancelLive`, `reactivateLive`, `getLiveReactivation`, `listLessonsForPicker`) |
| `./ui` | `CourseRow`, `TrackRow`, `LiveRow`, `RowSkeleton` — props-only list rows and the row skeleton (08.3-06); `CategoryPickerSheet` — the course form's single-select category sheet (08.3-07); `ReorderList`, `ModuleCard`, `LessonRow`, `PublishBlockedNotice` — the curriculum editor's parts (08.3-08); `CoursePickerSheet` — the track form's checklist of published courses (08.3-10); `LessonPickerSheet` — the live form's single-select replay picker grouped by course (08.3-11); the member side (08.5-06/07, ported from the prototype under `ui/member/`) `CourseCard`, `ProgressBar`, `LiveCard`, `ModuleCover`, `MemberLessonRow`, `MemberLessonThumb`, `ProgressRing`; every word arrives from the host |
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
`liveRowSchema`, `livePageSchema`, `liveDetailSchema` (`LIVE_STATUSES`, `liveReplaySchema`), the
reactivation read's `liveReactivationSchema` (08.6-06, D-452: `{ reactivatable }`, never a key on the
detail), the lifecycle event payloads `CourseLiveCancelled`, `CourseLiveScheduled` and
`CourseReplayAvailable` (08.6-06), the pure
`liveStatusAt(live, now)` (`scheduled | live | recorded | cancelled` — the clock's answer, never a
column), `LIVE_MAX_URL` (2048), the replay picker's `lessonPickerListSchema` and `LESSON_PICKER_MAX` (200),
the member lane (08.5) `LESSON_LOCK_REASONS` (`purchase | module | lesson`), `MODULE_LOCK_REASONS`,
`learnOutlineLessonSchema` (titles only, EP-14), `learnOutlineModuleSchema`, `learnProgressSchema`,
`learnCourseSchema`, `learnMaterialSchema` (never the asset id), `learnNeighbourSchema`,
`learnLessonSchema`, the progress write's `progressBodySchema` (strict `{ positionSeconds?, completed?:
true }`, `patch_empty` for `{}`), `progressResultSchema` (`{ completedAt, lastPositionSeconds }`),
`LESSON_COMPLETION_RATIO` (0.9) and `PROGRESS_MAX_POSITION_SECONDS` (14 400), the member catalogue
(08.5-04) `learnCatalogueQuerySchema`, `learnCategoryChipSchema`, `learnCourseCardSchema`,
`learnCataloguePageSchema`, the member lives `learnLiveCardSchema` (never a link or a replay lesson
id), `learnLivesQuerySchema`, `learnLivesPageSchema`, `learnLiveReplaySchema`, `learnLiveSchema`,
`LIVE_PAGE_STATES`, `LIVE_JOIN_LEAD_MINUTES` (15) and the pure `liveJoinWindowAt(live, now)`
(`[startsAt − 15 min, startsAt + durationMin)`, never open when cancelled), the member curriculum's
pure lock-label formatter (08.5-07, `contracts/lock.ts`) `lessonLockLabel`, `moduleLockLabel` and
`padNumber` (they label the server's `lockReason` with catalog keys, never decide a lock),
the level enum `COURSE_LEVELS`,
the caps `COURSE_MAX_TITLE`, `COURSE_MAX_TAGLINE`, `COURSE_MAX_DESCRIPTION`, `COURSE_MAX_OUTCOMES`,
`COURSE_MAX_OUTCOME`, `COURSE_MAX_HOURS`, `MODULE_MAX_TITLE`,
`MODULE_MAX_SUMMARY`, `LESSON_MAX_TITLE`, `LESSON_MAX_DESCRIPTION`, `LESSON_MAX_MATERIALS`,
`CATEGORY_MAX_NAME`, `TRACK_MAX_TITLE`, `TRACK_MAX_SUBTITLE`, `TRACK_MAX_AUDIENCE`,
`TRACK_MAX_DESCRIPTION`, `LIVE_MAX_TITLE`, `LIVE_MAX_DESCRIPTION`, `LIVE_MIN_DURATION`,
`LIVE_MAX_DURATION`, the permission names `COURSE_PERMISSIONS` (`courses.manage`), and the refusal
vocabulary `COURSE_ISSUES` / `COURSE_ISSUE_SET`.

Management routes (`/v1/courses`), every one behind `requireAuth`, `requireModule('courses')` AND
`requirePermission('courses.manage')` (the member routes follow in their own table):

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
| `POST /v1/courses/modules/{moduleId}/lessons` | `courses.manage` | add a lesson at the next position of its module; `videoAssetId` is a `lesson` video asset of this tenant in any status (`400 video_invalid` by name for an unknown or foreign id, `video_in_use` for one already linked); `requiresPrevious` ("Exige concluir a aula anterior", D-428, default false) is stored `false` on a free lesson and on the first live lesson of the course |
| `PUT /v1/courses/{courseId}/status` | `courses.manage` | `draft` / `published` / `archived`, idempotent; publishing answers `409 { courses: 'video_not_ready', lessonIds }` while a live lesson's video is missing from the lane or not ready (a soft-deleted lesson is ignored, a lesson without video never blocks, an empty course may publish); out of `archived` is `409 status_invalid`; archiving never consults readiness |
| `PATCH /v1/courses/modules/{moduleId}` | `courses.manage` | edit `title`, `summary`, `requiresPrevious` under the row lock; `requiresPrevious` is forced `false` on the first live module of the course (D-406); `400 patch_empty`; unknown, foreign or removed id is the bare 404 |
| `DELETE /v1/courses/modules/{moduleId}` | `courses.manage` | SOFT delete (`deleted_at`), 204; its lessons' rows and every progress row stay; a second call is the bare 404; the remaining modules keep a gap in `position` until the next reorder |
| `PUT /v1/courses/{courseId}/modules/order` | `courses.manage` | the whole order of the course's live modules as one permutation (D-414): the course row is locked first (bare 404), the live set `for update`, any set mismatch is `409 { courses: 'order_stale' }`, ONE `update … from unnest(...) with ordinality` touching only changed rows (the same order twice writes nothing); `ids` 1..200, every id once (a duplicate is 400); answers `{ items }` in the new order |
| `GET /v1/courses/lessons/{lessonId}` | `courses.manage` | the lesson detail: the view (video status and duration from the asset row), `materials` by `position, id` (each with `filename`, `mime`, `kind`, `bytes`), `module { id, title, position }`, `course { id, title, status, hasProducts }`; unknown, foreign or removed id is the bare 404 |
| `PATCH /v1/courses/lessons/{lessonId}` | `courses.manage` | edit `title`, `description`, `isFree`, `requiresPrevious` (stored `false` when the resulting lesson is free or is the first live lesson of the course, D-428), `videoAssetId` (null detaches; a `lesson` video asset of this tenant in any status attaches — `400 video_invalid` by name otherwise; one on ANOTHER live lesson is `400 video_in_use`, the partial unique index arbitrates a race); nothing about the video is typed (D-409) |
| `DELETE /v1/courses/lessons/{lessonId}` | `courses.manage` | SOFT delete (`deleted_at`), 204; progress rows and material rows stay (the material rows keep their assets governed by the course asset gate, 08.5 WR-01); the video asset is freed for another lesson; a second call is the bare 404; the lesson that becomes first in course order loses `requiresPrevious` |
| `PUT /v1/courses/modules/{moduleId}/lessons/order` | `courses.manage` | the whole order of the module's live lessons, the same statement and rules as the modules' (`order_stale`, idempotent replay); a module with no live lesson and a non-empty body is `order_stale`; the lesson that becomes first in course order loses `requiresPrevious` |
| `PUT /v1/courses/lessons/{lessonId}/materials` | `courses.manage` | REPLACES the lesson's ordered material set with `assetIds` (≤ 10, every id once — `400 too_many_materials`, a duplicate is 400) under the lesson row lock: every id a READY `attachment` file of this tenant (`400 material_invalid` for a cover, a pending or rejected upload; an unknown or foreign id is the bare 404); positions follow body order; a re-sent set keeps its rows; live rows outside the sent set are soft-deleted (`deleted_at`, so their assets stay governed by the course asset gate, 08.5 WR-01) and a re-sent detached asset revives its own row (same id); `[]` clears (D-410) |
| `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` | `courses.manage` | `{ url, expiresAt }` minted per request by `signReadFor(mediaOriginalKey(tenantId, assetId), 600)` after `assertTenantKey`, answered `Cache-Control: no-store`, never logged; a material of another lesson, tenant, a removed lesson or asset, or an unknown id is the bare 404 (T-08.3-06) |
| `GET /v1/courses/tracks` | `courses.manage` | the Trilhas tab: `filter=active` (the default) / `archived`, keyset over `(created_at desc, id desc)`, `limit` 1..50 (20), opaque `cursor`; `courseCount` counts ONLY the linked courses that are `published` right now (D-415) |
| `POST /v1/courses/tracks` | `courses.manage` | create an `active` track (title 1..120, subtitle ≤ 160, audience ≤ 60, description ≤ 2 000, optional ready `cover`) with no course yet; a track has no lessons, hours or certificate of its own (D-415) |
| `GET /v1/courses/tracks/{trackId}` | `courses.manage` | the admin detail: the row and EVERY linked course by `position, id` with its current `status` (the form marks a no-longer-published one); `courseCount` is the published ones only; unknown or foreign id is the bare 404 |
| `PATCH /v1/courses/tracks/{trackId}` | `courses.manage` | edit any subset of the fields under the row lock; the course list never travels here; `400 cover_invalid` / `patch_empty`; unknown or foreign id is the bare 404 |
| `PUT /v1/courses/tracks/{trackId}/status` | `courses.manage` | `active` / `archived`, idempotent in both directions (archive never deletes; `archived → active` is allowed for tracks); the same status answers the unchanged detail |
| `PUT /v1/courses/tracks/{trackId}/order` | `courses.manage` | the ONE write path of membership AND order (D-414, A8): `ids` REPLACES the link set in body order under the track row lock — absent ids unlinked, present ones linked, positions 1..N; every id a PUBLISHED course of this tenant (`400 course_invalid` for a draft, an archived, an unknown, a foreign or a non-uuid id, by name); `[]` clears; a duplicate is 400; the same list twice keeps the rows (`created_at` untouched, zero renumbered); a course may sit in several tracks |
| `GET /v1/courses/lives` | `courses.manage` | the Lives tab: `filter=upcoming` (the default: every live whose END is still ahead, soonest first on `(starts_at asc, id asc)`) / `past` (ended, latest first), `limit` 1..50 (20), opaque `cursor`; a cancelled live stays in its time bucket; each row's `status` is DERIVED at answer time by `liveStatusAt` — the table has no status column (D-416) |
| `POST /v1/courses/lives` | `courses.manage` | schedule a live (title 1..120, description ≤ 2 000, optional ready `cover`, `startsAt` an ISO instant with offset, `durationMin` 5..600, an `https` `externalUrl` — `400 url_invalid` for `http:`, `javascript:`, `ftp:` or a bare host; no product link, D-418); a start in the past is accepted and reads `recorded`; nothing streams in the app; a live whose start is ahead is announced to every member and support agent (D-448, D-449) |
| `GET /v1/courses/lives/{liveId}` | `courses.manage` | the detail: the fields, the derived `status`, `cancelledAt`, `products` (the store products that open it, read-only), `replayLesson { id, title, courseTitle }` or null; unknown or foreign id is the bare 404 |
| `PATCH /v1/courses/lives/{liveId}` | `courses.manage` | edit any subset under the row lock (no product link, D-418); `replayLessonId` (null clears) must be a LIVE lesson of this tenant (`400 lesson_invalid` by name) and is accepted only once the live has ENDED (`409 replay_too_early`); a cancelled live refuses the whole patch (`409 live_cancelled`); the same patch twice leaves the row; a moved `startsAt` re-arms the reminder silently (D-447); a replay set (non-null, new) is announced to those who can watch it (D-433, D-448) |
| `POST /v1/courses/lives/{liveId}/cancel` | `courses.manage` | sets `cancelled_at` ONCE (`coalesce(cancelled_at, now())` under the row lock) and answers the detail as `cancelled`; a second or a concurrent call answers 200 with the SAME instant; never a delete; the first cancel tells the members who turned the reminder on (D-447) |
| `POST /v1/courses/lives/{liveId}/reactivate` | `courses.manage` | (08.6-06, D-452) ONE guarded update under the row lock clears `cancelled_at` while the live is cancelled and its start is still ahead (database clock); re-arms the reminder for the surviving opt-ins in the same transaction (D-447) and tells every member and support agent the live is back (D-448); answers the detail; not cancelled or start passed → `409 live_not_reactivatable`, nothing written; unknown or foreign id is the bare 404 |
| `GET /v1/courses/lives/{liveId}/reactivation` | `courses.manage` | (08.6-06, UI-D-462) `{ reactivatable }`: cancelled and start still ahead, decided by the database clock, `Cache-Control: no-store`; unknown or foreign id is the bare 404 |
| `GET /v1/courses/lessons` | `courses.manage` | the replay picker's read: the tenant's live lessons under live modules with their course (`{ id, title, courseId, courseTitle, videoStatus }`), course newest first, then module and lesson position, capped at 200 |

Member routes (08.5), behind `requireAuth` and `requireModule('courses')` only — NO permission:
any member of the tenant reaches them and the database decides what they answer. Every role reads
PUBLISHED courses only (D-426); staff (`admin_tenant`, `support_tenant`) bypass the purchase and
sequence locks, never the publication. Every answer is `Cache-Control: no-store`. The refusal
vocabulary is closed: the bare 404 (`missing`: unknown, another tenant's, removed, under a removed
module, of a draft or archived course), `403 { courses: 'lesson_locked' }` (purchase),
`409 { courses: 'lesson_sequence_locked' }` (module or lesson rule unmet). The catalogue and the
lives routes (08.5-04) decide every state on the SERVER clock; the web never decides one with the
browser clock.

| Route | Who | What |
|---|---|---|
| `GET /v1/courses/learn/courses/{courseId}` | any role | the course page: header, `locked`, every live module and lesson BY TITLE with its `lockReason` and the caller's own progress, the summary (`done`, `total`, `percent`, `nextLessonId`, `firstLessonId`, `firstFreeLessonId`); a locked lesson carries no description, video, material or thumbnail (PR-1); bare 404 for a course that is not published |
| `GET /v1/courses/learn/lessons/{lessonId}` | any role | an OPEN lesson for the player: content, ready materials (no asset id), own progress, the module's lessons, neighbours with their lock reasons; bare 404 / `403 lesson_locked` / `409 lesson_sequence_locked` |
| `PUT /v1/courses/learn/lessons/{lessonId}/progress` | any role but `admin_tenant` | the caller's OWN progress (D-427): strict body `{ positionSeconds?: 0..14400, completed?: true }` (`400 patch_empty` for `{}`); the access answer first (404 / 403 / 409, nothing written); the position is clamped to the lesson's ready video duration (0 without one); completion on `completed: true` or at `ceil(0.9 × duration)`; ONE upsert on the primary key, `completed_at` one-way (`coalesce`), the position last-write-wins; a free lesson writes for a non-buyer (D-429); `admin_tenant` answers 204 and writes nothing (D-422) |
| `GET /v1/courses/learn/lessons/{lessonId}/materials/{materialId}/url` | any role | `{ url, expiresAt }`, a ten-minute signed URL minted per request like the admin's (`assertTenantKey`, `signReadFor(…, 600)`), never logged; the access answer first (404 / 403 / 409), then the material must be a ready material of THAT open lesson (`app.course_lesson_material_list`), else the bare 404 |
| `GET /v1/courses/learn/courses` | any role | the catalogue (D-420, D-421, D-430): `{ items, categories, nextCursor }`; PUBLISHED courses only, newest published first (`published_at desc, id desc`, a republish keeps its place), locked and open courses in ONE list; each card has `locked` (false for staff and with the store off), the FULL `lessonCount` / `durationSeconds` (from `app.course_catalogue_stats()`) and the caller's own `completedCount`; `categories` are only those holding a published course (`lower(name), id`); `?categoryId=&cursor=&limit=1..50` |
| `GET /v1/courses/learn/lives` | any role | the agenda (D-431): page 1 carries the WHOLE `upcoming` group (live now, scheduled, cancelled until its planned end; `startsAt asc, id asc`) and the first 20 `recorded` lives with a live replay (`startsAt desc, id desc`); `?cursor=` pages `recorded` only; cards come from `app.course_live_cards()`, a locked live is listed `locked: true`, and no card carries the room link or the replay lesson id |
| `GET /v1/courses/learn/lives/{liveId}` | any role | the live page (D-432..D-434): the card plus `description`, `state` (`cancelled` > `locked` > `open` > `before` > `replay` > `ended`), `joinUrl` (the stored link, read through the lane under the restrictive live gate, ONLY inside `[startsAt − 15 min, startsAt + durationMin)` on the server clock — `liveJoinWindowAt` — and never for a caller without access), `joinOpensAt`, `serverNow`, `startsToday` (tenant timezone) and `replay` (video, materials, own progress); the replay opens through EITHER door: the live door (the live's product, even without the lesson's course, ignoring its sequential lock) or, for the course player, the course door; a cancelled live keeps its page; bare 404 for an unknown or another tenant's live |

Progress stays the member's own bookkeeping: no route lists another member's rows, and the progress
policies (`course_lesson_progress_insert_own`, `_update_own`) refuse the `admin_tenant` claim and a
lesson the lane cannot open (`with check … app.tenant_role() is distinct from 'admin_tenant' and
app.course_lesson_access(lesson_id) is null`), so a skip is refused by the route AND by RLS.
Unpublishing, archiving, removing a lesson or a module, or revoking an entitlement never deletes or
rewrites a progress row (D-426, D-408).

Member functions (`supabase/migrations/*_courses_member_functions.sql`, 08.5-01): `language sql
stable security definer set search_path = ''`, every statement pinned to `app.tenant_id()`, EXECUTE
granted to `authenticated` only.

- `app.course_lesson_states(uuid)` — THE lock evaluator: every live lesson of a course with its
  course order, module rank, lock reason (`purchase | module | lesson | null`) and the caller's
  own progress.
- `app.course_lesson_access(uuid)` — the one access answer for a lesson: `missing`, `purchase`,
  `sequence` or NULL (open), through the course door or the live door (a replay, D-433).
- `app.course_outline(uuid)` — the titles-only curriculum of a published course (D-423).
- `app.course_lesson_content(uuid)` — an open lesson's content and ready video duration.
- `app.course_lesson_material_list(uuid)` — an open lesson's ready, live materials.
- `app.course_live_cards(uuid default null)` — the member's live cards, never `external_url` or the
  replay id.
- `app.course_catalogue_stats()` — per published course: live lesson count, ready duration and the
  caller's completed count, for the catalogue cards.
- `app.course_asset_hidden(uuid)` — this module's body of the kernel asset seam (below).

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

Seams (08.5):

- CONSUMED — the kernel course-gate seam above (`app.course_locked_ids()`,
  `app.course_locked_ids_for(uuid)`, `app.live_locked_ids()`, `app.live_locked_ids_for(uuid)`),
  bodies by the store: the evaluator's `purchase` reason and the live door read them, always as
  `coalesce((select app.f()), '{}'::uuid[])`.
- IMPLEMENTED — the kernel asset seam `app.course_asset_hidden(uuid)` declared by
  `supabase/migrations/*_course_asset_gate_seam.sql` (kernel stub: `false`, helper
  `courseAssetHidden` in `@rede-social/core/db/course-gate`); this module's body (last statement of
  `*_courses_member_functions.sql`, replaced in place by `*_courses_asset_gate_fail_closed.sql`,
  quick 261016-aqc, 08.5 WR-01) governs a `lesson` video, or any asset that is or was a material of
  the tenant (any lesson, any row state: live or soft-deleted, under a live or removed lesson or
  module), and hides it from a member lane unless a LIVE material row or the video slot of an
  openable live lesson holds it. The `admin_tenant` claim is always served (the admin course page
  mints draft thumbnails); `support_tenant` takes the same access answer as a member, so it is never
  locked on a published course and is refused a draft's lesson assets (quick 261016-eg6, 08.5
  IN-01, `*_courses_asset_gate_admin_only.sql`). The kernel media service asks it
  in `playbackTokens` and in `serveVariant('original')`.

## Events emitted

Payloads carry ids and instants only, never a title, URL or room link (T-07-31).

- `course.live_reminder_due` (08.6-05, D-445): `tenantId`, `liveId`, `startsAt`, emitted by the
  live reminder job (see "Jobs") once its fire-time checks pass, and flushed before the job returns.
- `course.live_cancelled` (08.6-06, D-447): `tenantId`, `liveId`, `actorUserId`, `cancelledAt`,
  emitted by `cancelLive` after commit on the FIRST cancel only (a repeated cancel emits nothing).
  A moved start (`updateLive`) emits nothing: it re-arms the reminder in its transaction instead.
- `course.live_scheduled` (08.6-06, D-448): `tenantId`, `liveId`, `actorUserId`, `startsAt`,
  `reactivated`, emitted after commit by `createLive` for a live whose start is after the database's
  `now()` (`reactivated: false`; a live created in the past emits nothing) and by `reactivateLive`
  (`reactivated: true`).
- `course.replay_available` (08.6-06, D-448, D-433): `tenantId`, `liveId`, `lessonId`,
  `actorUserId`, emitted after commit by `updateLive` when the patch sets a non-null replay lesson
  different from the stored one.
- `course.published` (08.6-07, D-448): `tenantId`, `courseId`, `actorUserId`, `notifiedAt`, emitted
  after commit by `setCourseStatus` on a `draft → published` transition only when its guarded
  24-hour stamp (the course's `published_notified_at`, NULL or older than a day) was written: a republish
  within 24 hours emits nothing.
- `course.lessons_added` (08.6-07, D-450): `tenantId`, `courseId`, `count`, `batchAt`, emitted by
  the lessons batch job (see "Jobs") when its claim announced at least one lesson, and flushed before
  the job returns.
- `course.unpublished` (08.6-07, D-454): `tenantId`, `courseId`, `actorUserId`, emitted after commit
  by `setCourseStatus` on a `published → draft` or `published → archived` transition. It has no
  source, only the retraction below.

## Events consumed

- Manifest subscriptions: none (08.6-05 planning decision 4: the service and the job log ids-only
  lines themselves).
- Notification sources (handed to the notifications module through the kernel seam, D-451):
  `course.live_reminder_due` → one live reminder intent (in-app and push) to the users of
  `app.course_live_reminder_user_ids(liveId, true)`: members who opted in, still hold a live
  membership and can still open the live.
  `course.live_cancelled` (08.6-06, D-447) → one actor-less cancel notice (in-app and push, opening
  the live page) to the users of `app.course_live_reminder_user_ids(liveId, false)`: the members who
  turned the reminder on, without an access check, and only while the live is still cancelled and
  its planned end was still ahead at the cancel (R-A9).
  `course.live_scheduled` (08.6-06, D-448, D-449, D-452, D-453) → one new-live notice (in-app and
  push, with the actor's avatar, the actor excluded) to the users of
  `app.course_notice_user_ids()`: every live member and support membership, with or without access
  (a shop window, D-449). Nothing while the live is cancelled or its start has passed; a reactivation
  is a distinct notice (its dedupe key carries the sink instant) reading "Live reativada".
  `course.replay_available` (08.6-06, D-448, D-433) → one actor-less replay notice naming the live,
  never the lesson, to the users of `app.live_replay_audience_user_ids(liveId)`: those who open the
  live door or the course door (the sequence lock ignored). Nothing once the live no longer replays
  that lesson.
  `course.published` (08.6-07, D-448, D-449, D-453) → one new-course notice (in-app and push,
  "Novo curso: {title}", opening the course page, with the actor's avatar, the actor excluded) to the
  users of `app.course_notice_user_ids()`: every live member and support membership, with or without
  access (a shop window). Nothing once the course is no longer published; the dedupe key carries the
  24-hour stamp. The facts are `courseId`, `title` and the cover as `previewAssetId`.
  `course.lessons_added` (08.6-07, D-448, D-449, D-450) → one actor-less new-lessons notice (in-app
  and push, "Nova aula em {title}" or "{n} aulas novas em {title}", opening the course page) to the
  users of `app.course_audience_user_ids(courseId)`: only the members and support agents for whom the
  course is open. Nothing once the course is no longer published; one notice per batch (the dedupe
  key carries the claim instant). The facts are `courseId`, `title`, `count` and the cover as
  `previewAssetId`, never a lesson.
  Every source answers nothing while the tenant's `courses` row is off (read from `tenant_modules`
  inside the fan-out transaction). The six courses kinds are declared together in
  `COURSES_NOTIFICATION_KINDS`.
- Notification retractions (08.6-07, D-454): `course.unpublished` → every notification whose subject
  is the course (the course-published and lessons-added kinds) is marked removed
  (keep-and-mark, `{"removed": true}`), so a withdrawn course is never named in the bell; live
  notices (subject `live`) are untouched. It runs even while the `notifications` module is off.

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
- `@rede-social/core/server/events/bus` (`emit`, `flush`: the live reminder job, 08.6-05; the lessons
  batch, 08.6-07)
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/jobs/boss` (`enqueueInTx`, the live reminder's arming, 08.6-05; the
  lessons batch's arming, 08.6-07)
- `@rede-social/core/server/logging`
- `@rede-social/core/server/media/keys` (`mediaOriginalKey`, `assertTenantKey`)
- `@rede-social/core/server/media/storage` (`signReadFor`)
- `@rede-social/core/server/modules/flags-cache` (`moduleFlags.isEnabled`, the reminder's fire-time
  school check, 08.6-05)
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source` (`NotificationIntent`, `NotificationSource`, 08.6-05;
  `NotificationRetraction`, 08.6-07)
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
- `@rede-social/core/ui` (`MediaImage`, for the member cards, thumbs and module bands, 08.5-06/07)

## Navigation

- Tab "Cursos" (08.5-11, D-419, UI-D-423): placement `tab`, href `/cursos`, icon `graduation-cap`,
  order 30, labelled by the web catalog's `courses.nav`. With the school on, the BottomNav reads
  Início · Comunidades · Cursos · Eventos · Perfil; `/cursos` splits by role (the hub for
  `courses.manage`, the member catalogue for everyone else). Reels shares order 30 and declares
  `yieldsTabTo: ['courses']`, so the kernel's `buildNav` moves it to the leftmost TopBar slot while
  this tab exists (data, never a module name in the kernel). With the school off (08.3's D-401
  state) nothing of this reaches the bootstrap and the bar is unchanged. Through 08.3 the manifest
  declared no nav; the admin entered through the Cursos row in Configurações → Administração
  (08.3-06), which stays.
- Home slots: none.

## Jobs

- `courses.live_reminder` (`liveReminderJob`, 08.6-05, D-445..D-447): one deferred job per live and
  start (singleton key `{liveId}:{startsAtEpochSeconds}`), armed inside the member's opt-in
  transaction to fire 15 minutes before the start (the join window's opening), and checked again
  when it fires (skips `not_found`, `cancelled`, `moved`, `module_off`, `started`, `late` beyond 10
  minutes). Runs in `coursesSystemCtx` (the zero user under the `support_tenant` claim).
- `courses.lessons_batch` (`lessonsBatchJob`, 08.6-07, D-450): one deferred job per course (singleton
  key = the course id), armed inside `createLesson` on a published course to run 30 minutes later,
  so every lesson created while it waits joins the batch. It ends with the school off; otherwise it
  claims the announcement watermark with `app.course_lessons_claim_batch(course)` (unannounced live
  lessons of the published course whose video is absent or ready), emits `course.lessons_added` with
  the claimed count when it is above zero, and re-arms itself one window later while lessons whose
  video is still processing remain and the oldest is younger than 24 hours. Runs in
  `coursesSystemCtx`.
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
