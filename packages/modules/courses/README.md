# @rede-social/module-courses

The tenant's school (Phase 08.3, COURSE-01..15): courses the `admin_tenant` authors — title, tagline,
description, category, level, cover, instructor, "o que você vai dominar", optional certificate hours
— with ordered modules and ordered lessons whose videos ride the existing direct-to-provider media
pipeline as `lesson`-purpose assets (D-409), categories, tracks and lives. A course links to zero or
more store products; an entitlement to any of them opens it, no link means open to every member
(D-404). Only the course has a publication state, `draft → published → archived` with unpublish
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
| `./server` | `coursesRoutes` and the service functions (`createCourse`, `getCourse`, `createModule`, `createLesson`, `setCourseStatus`) |
| `./db` | Drizzle tables `courseCategories`, `courses`, `courseModules`, `courseLessons`, `courseLessonMaterials`, `courseProducts`, `courseLessonProgress`, `courseTracks`, `courseTrackCourses`, `courseLives`, `courseLiveProducts` with their RLS policies |

Main contract names (`./contracts`): `courseInputSchema`, `coursePatchSchema`,
`courseStatusBodySchema` (`COURSE_STATUSES`), `courseDetailSchema` (with the derived `moduleCount`,
`lessonCount`, `durationSeconds`, `hasUnreadyVideo`, `unreadyLessonIds`), `courseProductSchema`,
`moduleInputSchema`, `modulePatchSchema`, `moduleViewSchema`, `lessonInputSchema`,
`lessonPatchSchema`, `lessonViewSchema` (`LESSON_VIDEO_STATUSES`), the level enum `COURSE_LEVELS`,
the caps `COURSE_MAX_TITLE`, `COURSE_MAX_TAGLINE`, `COURSE_MAX_DESCRIPTION`, `COURSE_MAX_OUTCOMES`,
`COURSE_MAX_OUTCOME`, `COURSE_MAX_HOURS`, `COURSE_MAX_PRODUCTS`, `MODULE_MAX_TITLE`,
`MODULE_MAX_SUMMARY`, `LESSON_MAX_TITLE`, `LESSON_MAX_DESCRIPTION`, `LESSON_MAX_MATERIALS`,
`CATEGORY_MAX_NAME`, `TRACK_MAX_TITLE`, `TRACK_MAX_SUBTITLE`, `TRACK_MAX_AUDIENCE`,
`TRACK_MAX_DESCRIPTION`, `LIVE_MAX_TITLE`, `LIVE_MAX_DESCRIPTION`, `LIVE_MIN_DURATION`,
`LIVE_MAX_DURATION`, the permission names `COURSE_PERMISSIONS` (`courses.manage`), and the refusal
vocabulary `COURSE_ISSUES` / `COURSE_ISSUE_SET`.

Routes (`/v1/courses`), every one behind `requireAuth`, `requireModule('courses')` AND
`requirePermission('courses.manage')` (no member route exists in 08.3; later plans append rows):

| Route | Who | What |
|---|---|---|
| `POST /` | `courses.manage` | create a `draft` course with its product links (the ONE write path of a course-to-product link, D-404) |
| `GET /{courseId}` | `courses.manage` | the manager's detail: category, products, live modules with their live lessons, video status and duration per lesson, the derived aggregates |
| `POST /{courseId}/modules` | `courses.manage` | add a module at the next position; the first module never `requiresPrevious` (D-406) |
| `POST /modules/{moduleId}/lessons` | `courses.manage` | add a lesson at the next position of its module; `videoAssetId` is a `lesson` video asset of this tenant in any status (`400 video_invalid` by name for an unknown or foreign id, `video_in_use` for one already linked) |
| `PUT /{courseId}/status` | `courses.manage` | `draft` / `published` / `archived`, idempotent; publishing answers `409 { courses: 'video_not_ready', lessonIds }` while a lesson's video is not ready; out of `archived` is `409 status_invalid` |

The products a course links to are read from `public.store_products` by SQL inside this module's
own statements (`product_invalid` for anything that is not an active product of the tenant); the
courses package imports nothing from the store package (MOD-02). Archiving or unpublishing a course
never deletes a module, a lesson, a link or a progress row.

SQL the module relies on:

- the kernel course-gate seam declared by `supabase/migrations/*_course_gate_seam.sql` (see
  `packages/core/db/README.md`): `app.course_locked_ids()`, `app.course_locked_ids_for(uuid)`,
  `app.live_locked_ids()`, `app.live_locked_ids_for(uuid)`. The restrictive policy
  `course_lessons_course_gate` (`app.tenant_role() = 'admin_tenant' or is_free or course_id <> all
  (coalesce((select app.course_locked_ids()), '{}'::uuid[]))`) is built from `LOCKED_COURSE_IDS` of
  `@rede-social/core/db/course-gate`. The STORE module implements the four bodies in its
  `supabase/migrations/*_store_course_gate.sql` (a course or live linked to ≥ 1 product for which the
  user holds no active entitlement is locked; staff never are; store off → nothing locked);
- the hand-written `course_products_product_fk` and `course_live_products_product_fk` to
  `store_products(id) on delete cascade` in `supabase/migrations/*_courses_functions.sql` — the one
  file a store-less reuse of this module drops.

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
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
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

UI (`./ui`) arrives in plan 06: props only, no words of their own, no other module imported.

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: a request id and a per-request
logger, an `onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `courses.manage`), the kernel migration
`*_course_gate_seam.sql` applied before this module's migrations, and
`.route('/v1/courses', coursesRoutes)`. The routes carry their own `requireAuth`,
`requireModule('courses')` and `requirePermission` chain. A project without the store keeps the
kernel stubs (every course and live open), drops `*_courses_functions.sql` (the two hand FKs to
`store_products`) and never applies the store's `*_store_course_gate.sql`.
