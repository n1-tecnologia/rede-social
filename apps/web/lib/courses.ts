import {
  type Category,
  type CategoryInput,
  type CategoryList,
  type CategoryPatch,
  COURSE_ISSUE_SET,
  COURSE_PAGE_SIZE,
  type CourseDetail,
  type CourseFilter,
  type CourseInput,
  type CourseIssue,
  type CoursePage,
  type CoursePatch,
  type CourseStatus,
  categoryListSchema,
  categorySchema,
  courseDetailSchema,
  coursePageSchema,
  type LessonDetail,
  type LessonInput,
  type LessonPatch,
  type LessonView,
  lessonDetailSchema,
  lessonListSchema,
  lessonViewSchema,
  type MaterialsBody,
  type MaterialUrl,
  type ModuleInput,
  type ModulePatch,
  type ModuleView,
  materialUrlSchema,
  moduleListSchema,
  moduleViewSchema,
  type ReorderLessons,
  type ReorderModules,
} from '@rede-social/module-courses/contracts';
import { STORE_MAX_PAGE_SIZE } from '@rede-social/module-store/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import type { CourseFormProduct } from '@/lib/courses-view';
import { getProducts } from '@/lib/store';

/**
 * The ONE courses fetch implementation (08.3-06, the `lib/store.ts` shape). The `/cursos` hub, its
 * load-more action, the course page and the forms of plans 07-09 all read THIS, so the list and
 * its next page can never disagree about the page size or the filter vocabulary.
 *
 * The browser never talks to Supabase for course data: every read goes through `apiFetch` to the
 * Hono API, which re-verifies the token, re-reads the membership, gates the module
 * (`requireModule('courses')`: 404 `MODULE_DISABLED` while it is off) and the permission
 * (`requirePermission('courses.manage')`: 403 for anyone but the tenant admin, D-403).
 *
 * **The web never sorts** (P09): the list renders the API's order (newest first) and appends pages
 * in order. **The cursor is opaque**: forwarded exactly as the previous page returned it, never
 * parsed here (the API refuses a tampered one with 400, T-08.3-19).
 *
 * Two API readings the web must honour (08.3-04, 08.3-05): an unknown or foreign cover id is
 * `400 cover_invalid` (an issue, never a 404), and `409 order_stale` on a reorder means "reload and
 * retry" — both arrive here as `issue` outcomes with their code.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code: every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The code every courses route answers with the module off (`requireModule('courses')`). */
export const COURSES_MODULE_DISABLED = 'MODULE_DISABLED';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export type CourseQueryInput = { filter: CourseFilter; cursor?: string; limit?: number };

/**
 * `GET /v1/courses?filter=&cursor=&limit=` (08.3-04, COURSE-02). `filter` is always sent explicitly
 * (the API's closed enum); `limit` defaults to `COURSE_PAGE_SIZE`. Throws an `ApiClientError` on any
 * refusal: the hub page splits it three ways (disabled → not-found, a bootstrap refusal → redirect,
 * anything else → the first-load error card).
 */
export async function getCourses(query: CourseQueryInput): Promise<CoursePage> {
  const search = new URLSearchParams();
  search.set('filter', query.filter);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? COURSE_PAGE_SIZE));

  const res = await apiFetch(`/v1/courses?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return coursePageSchema.parse(await res.json());
}

/**
 * A read's answer: the row, the ONE not-found (unknown or another tenant's: the API answers one
 * bare 404 for both, D-23), the module being off, a refusal the bootstrap knows, or a read failure.
 */
export type CourseResult =
  | { status: 'ok'; course: CourseDetail }
  | { status: 'not-found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/{courseId}` (08.3-01, COURSE-02): the manager's detail with the live modules and
 * lessons, the products and the publish-blocking lesson ids. A 400 (not a uuid) collapses into
 * `not-found` like the bare 404, so the page renders one screen for every miss. `MODULE_DISABLED` is
 * told apart: with the module off the app's generic not-found renders, never the school's own card
 * (UI-D-412). The caller performs the redirect (`redirect()` throws, so it never runs here).
 */
export async function getCourse(courseId: string): Promise<CourseResult> {
  try {
    const res = await apiFetch(`/v1/courses/${encodeURIComponent(courseId)}`);
    if (res.ok) return { status: 'ok', course: courseDetailSchema.parse(await res.json()) };
    const error = await apiError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('courses.read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

export type CategoriesResult =
  | { status: 'ok'; categories: CategoryList['items'] }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/categories` (08.3-04, D-411): every category of the tenant with its course count,
 * ordered by name. The hub's "Categorias" row reads the length; the category manager (plan 07) the
 * rows. Never throws.
 */
export async function getCategories(): Promise<CategoriesResult> {
  try {
    const res = await apiFetch('/v1/courses/categories');
    if (res.ok) {
      return { status: 'ok', categories: categoryListSchema.parse(await res.json()).items };
    }
    const error = await apiError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('courses.categories_read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.categories_read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A course write's answer (08.3-04, D-413): the saved detail, a closed `details.courses` refusal (a
 * field issue the form draws under its field, a by-name reference refusal such as `cover_invalid`
 * or `product_invalid`, or a 409 such as `video_not_ready` — whose `lessonIds` ride in `details`),
 * the bare 404 (`gone`: an unknown or foreign course), the module being off, a navigation the
 * bootstrap knows (401, blocked, suspended…), or anything else. Never throws.
 */
export type CourseWriteOutcome =
  | { status: 'ok'; course: CourseDetail }
  | { status: 'issue'; issue: CourseIssue; details?: Record<string, unknown> }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** The shared refusal mapping of every courses write; shape-only logging (never a title). */
async function writeRefusal(
  res: Response,
  op: string,
): Promise<Exclude<CourseWriteOutcome, { status: 'ok' }>> {
  const error = await apiError(res);
  const issue = error.details?.courses;
  if (typeof issue === 'string' && COURSE_ISSUE_SET.has(issue)) {
    return { status: 'issue', issue: issue as CourseIssue, details: error.details };
  }
  if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
  if (res.status === 404) return { status: 'gone' };
  const path = bootstrapRedirectPath(error);
  if (path) return { status: 'redirect', path };
  console.error(`courses.${op}_failed`, { status: res.status, code: error.code });
  return { status: 'error' };
}

/**
 * `POST /v1/courses` (08.3-01, COURSE-02): the body is the create contract the action has already
 * parsed (`courseInputSchema`); the API re-validates it and answers the detail (201).
 */
export async function createCourse(input: CourseInput): Promise<CourseWriteOutcome> {
  try {
    const res = await apiFetch('/v1/courses', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    if (res.ok) return { status: 'ok', course: courseDetailSchema.parse(await res.json()) };
    return await writeRefusal(res, 'create');
  } catch (error) {
    console.error('courses.create_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PATCH /v1/courses/{courseId}` (08.3-04, D-404): ONLY the keys the admin changed. The patch
 * contract has no defaults, so an omitted key leaves its column alone. `productIds`, when present,
 * REPLACES the course's whole link set: the course form is the only link writer.
 */
export async function updateCourse(
  courseId: string,
  patch: CoursePatch,
): Promise<CourseWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/${encodeURIComponent(courseId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    if (res.ok) return { status: 'ok', course: courseDetailSchema.parse(await res.json()) };
    return await writeRefusal(res, 'update');
  } catch (error) {
    console.error('courses.update_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PUT /v1/courses/{courseId}/status { status }` (08.3-01, D-413): idempotent publish, unpublish
 * and archive. A publish while a lesson's video is not ready is `409 video_not_ready` with the
 * blocking `lessonIds` in `details` (COURSE-03); out of `archived` is `409 status_invalid`.
 */
export async function setCourseStatus(
  courseId: string,
  status: CourseStatus,
): Promise<CourseWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/${encodeURIComponent(courseId)}/status`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status }),
    });
    if (res.ok) return { status: 'ok', course: courseDetailSchema.parse(await res.json()) };
    return await writeRefusal(res, 'status');
  } catch (error) {
    console.error('courses.status_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A category write's answer (08.3-04, D-411): the saved category (none for a removal), a closed
 * refusal (`title_required`, `category_exists`, `category_in_use` with `courseCount` in `details`,
 * `cover_invalid`), the bare 404 (`gone`), the module being off, a navigation the bootstrap knows,
 * or anything else. Never throws.
 */
export type CategoryWriteOutcome =
  | { status: 'ok'; category: Category | null }
  | { status: 'issue'; issue: CourseIssue; details?: Record<string, unknown> }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

async function categoryRefusal(res: Response, op: string): Promise<CategoryWriteOutcome> {
  const refusal = await writeRefusal(res, op);
  return refusal;
}

/** `POST /v1/courses/categories` (08.3-04, COURSE-04). */
export async function createCategory(input: CategoryInput): Promise<CategoryWriteOutcome> {
  try {
    const res = await apiFetch('/v1/courses/categories', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    if (res.ok) return { status: 'ok', category: categorySchema.parse(await res.json()) };
    return await categoryRefusal(res, 'category_create');
  } catch (error) {
    console.error('courses.category_create_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** `PATCH /v1/courses/categories/{categoryId}` (08.3-04): only the keys the admin changed. */
export async function updateCategory(
  categoryId: string,
  patch: CategoryPatch,
): Promise<CategoryWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/categories/${encodeURIComponent(categoryId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    if (res.ok) return { status: 'ok', category: categorySchema.parse(await res.json()) };
    return await categoryRefusal(res, 'category_update');
  } catch (error) {
    console.error('courses.category_update_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `DELETE /v1/courses/categories/{categoryId}` (08.3-04, D-411): 204 for an empty category;
 * `409 category_in_use { courseCount }` while any course — archived ones included — references it.
 */
export async function deleteCategory(categoryId: string): Promise<CategoryWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/categories/${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
    });
    if (res.ok) return { status: 'ok', category: null };
    return await categoryRefusal(res, 'category_delete');
  } catch (error) {
    console.error('courses.category_delete_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/* ── 08.3-07: the course form's product picker (D-404, D-405) ────────────────────────────────── */

/** How many catalogue pages the picker walk may read (enough for `COURSE_MAX_PRODUCTS` and then some). */
const PICKER_MAX_PAGES = 4;

/**
 * EVERY active product of the tenant for the course form's "Liberado pelos produtos" picker
 * (D-404): the store's own `getProducts({ filter: 'all' })` walked by keyset, composed HERE in the
 * app tier so the courses module never imports the store (D-405: `courses` does not require
 * `store`; the pages call this only while the store is on and the admin holds its permission).
 *
 * Never throws: an unreadable catalogue offers no rows and the course still saves (the saved links
 * stay untouched because the form sends `productIds` only when the selection changes). Shape-only
 * logging: a product NAME is tenant content.
 */
export async function listCourseFormProducts(): Promise<CourseFormProduct[]> {
  const items: CourseFormProduct[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < PICKER_MAX_PAGES; page += 1) {
      const result = await getProducts({ filter: 'all', cursor, limit: STORE_MAX_PAGE_SIZE });
      for (const product of result.items) {
        items.push({
          id: product.id,
          name: product.name,
          imageAssetId: product.imageAssetId,
          status: product.status,
        });
      }
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
  } catch (error) {
    console.error('courses.products_picker_failed', {
      ...(error instanceof ApiClientError
        ? { status: error.status, code: error.code }
        : { error: String(error) }),
      loaded: items.length,
    });
  }
  return items;
}

/* ── 08.3-08: the curriculum editor's writes (COURSE-05, COURSE-06, D-406, D-414) ───────────── */

/**
 * A module write's answer (08.3-05): the module with its live lessons (none after a removal), a
 * closed refusal (`title_required`, `title_too_long`, `description_too_long`, `patch_empty`), the
 * bare 404 (`gone`: an unknown, foreign or removed module — or course, on create), the module being
 * off, a navigation the bootstrap knows, or anything else. Never throws.
 */
export type ModuleWriteOutcome =
  | { status: 'ok'; module: ModuleView | null }
  | { status: 'issue'; issue: CourseIssue; details?: Record<string, unknown> }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/courses/{courseId}/modules` (08.3-01, COURSE-05): the module lands at the course's next
 * position; `requiresPrevious` is forced off on the first module (D-406).
 */
export async function createModule(
  courseId: string,
  input: ModuleInput,
): Promise<ModuleWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/${encodeURIComponent(courseId)}/modules`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    if (res.ok) return { status: 'ok', module: moduleViewSchema.parse(await res.json()) };
    return await writeRefusal(res, 'module_create');
  } catch (error) {
    console.error('courses.module_create_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** `PATCH /v1/courses/modules/{moduleId}` (08.3-05): only the keys the admin changed. */
export async function updateModule(
  moduleId: string,
  patch: ModulePatch,
): Promise<ModuleWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/modules/${encodeURIComponent(moduleId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    if (res.ok) return { status: 'ok', module: moduleViewSchema.parse(await res.json()) };
    return await writeRefusal(res, 'module_update');
  } catch (error) {
    console.error('courses.module_update_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `DELETE /v1/courses/modules/{moduleId}` (08.3-05, PR-5): a soft delete — the row stays with
 * `deleted_at`, its lessons and every progress row stay (D-408); the module leaves every list.
 */
export async function deleteModule(moduleId: string): Promise<ModuleWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/modules/${encodeURIComponent(moduleId)}`, {
      method: 'DELETE',
    });
    if (res.ok) return { status: 'ok', module: null };
    return await writeRefusal(res, 'module_delete');
  } catch (error) {
    console.error('courses.module_delete_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A whole-order write's answer (D-414): the parent's live children in the new order, or a refusal.
 * `409 order_stale` arrives as the `issue` outcome with that code: the set changed under the admin —
 * reload and retry (T-08.3-10).
 */
export type ReorderOutcome<T> =
  | { status: 'ok'; items: T[] }
  | { status: 'issue'; issue: CourseIssue; details?: Record<string, unknown> }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `PUT /v1/courses/{courseId}/modules/order` (08.3-05, D-414): `ids` is the course's EVERY live
 * module exactly once, in the new order; the answer is the modules (with their lessons) in that order.
 */
export async function reorderModules(
  courseId: string,
  body: ReorderModules,
): Promise<ReorderOutcome<ModuleView>> {
  try {
    const res = await apiFetch(`/v1/courses/${encodeURIComponent(courseId)}/modules/order`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    if (res.ok) return { status: 'ok', items: moduleListSchema.parse(await res.json()).items };
    return await writeRefusal(res, 'modules_reorder');
  } catch (error) {
    console.error('courses.modules_reorder_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PUT /v1/courses/modules/{moduleId}/lessons/order` (08.3-05, D-414): the module's EVERY live
 * lesson exactly once, in the new order; the answer is the lessons in that order.
 */
export async function reorderLessons(
  moduleId: string,
  body: ReorderLessons,
): Promise<ReorderOutcome<LessonView>> {
  try {
    const res = await apiFetch(
      `/v1/courses/modules/${encodeURIComponent(moduleId)}/lessons/order`,
      {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return { status: 'ok', items: lessonListSchema.parse(await res.json()).items };
    return await writeRefusal(res, 'lessons_reorder');
  } catch (error) {
    console.error('courses.lessons_reorder_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/* ── 08.3-09: the lesson form's reads and writes (COURSE-06, COURSE-07, D-407, D-409, D-410) ── */

/**
 * A lesson read's answer: the detail (the view, its materials, its module and its course with
 * `hasProducts`), the ONE not-found (unknown, foreign or removed: the API answers one bare 404 for
 * all three, D-23; a 400 non-uuid collapses into it), the module being off, a refusal the bootstrap
 * knows, or a read failure. Never throws.
 */
export type LessonResult =
  | { status: 'ok'; lesson: LessonDetail }
  | { status: 'not-found' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/** `GET /v1/courses/lessons/{lessonId}` (08.3-05, COURSE-06): the lesson form's reading. */
export async function getLesson(lessonId: string): Promise<LessonResult> {
  try {
    const res = await apiFetch(`/v1/courses/lessons/${encodeURIComponent(lessonId)}`);
    if (res.ok) return { status: 'ok', lesson: lessonDetailSchema.parse(await res.json()) };
    const error = await apiError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'not-found' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('courses.lesson_read_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.lesson_read_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * A lesson write's answer (08.3-05): the lesson — the VIEW after a create (the API answers the row
 * at its module's next position), the DETAIL after an edit or a materials replace, `null` after a
 * removal —, a closed refusal (`title_required`, `title_too_long`, `description_too_long`,
 * `video_invalid`, `video_in_use`, `patch_empty`, `material_invalid`, `too_many_materials`), the bare
 * 404 (`gone`: an unknown, foreign or removed lesson or module — or, on a materials replace, an
 * unknown or foreign ASSET id, T-08.3-20), the module being off, a navigation the bootstrap knows,
 * or anything else. Never throws.
 */
export type LessonWriteOutcome =
  | { status: 'ok'; lesson: LessonView | LessonDetail | null }
  | { status: 'issue'; issue: CourseIssue; details?: Record<string, unknown> }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `POST /v1/courses/modules/{moduleId}/lessons` (08.3-01, COURSE-06, D-409): the lesson at the
 * module's next position. `videoAssetId` is a `lesson`-purpose asset of this tenant in ANY status
 * (null is a practice lesson); the API reads its status from the asset row — nothing about the video
 * is typed (PR-6).
 */
export async function createLesson(
  moduleId: string,
  input: LessonInput,
): Promise<LessonWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/modules/${encodeURIComponent(moduleId)}/lessons`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    if (res.ok) return { status: 'ok', lesson: lessonViewSchema.parse(await res.json()) };
    return await writeRefusal(res, 'lesson_create');
  } catch (error) {
    console.error('courses.lesson_create_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** `PATCH /v1/courses/lessons/{lessonId}` (08.3-05): only the keys the admin changed; the detail answers. */
export async function updateLesson(
  lessonId: string,
  patch: LessonPatch,
): Promise<LessonWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    if (res.ok) return { status: 'ok', lesson: lessonDetailSchema.parse(await res.json()) };
    return await writeRefusal(res, 'lesson_update');
  } catch (error) {
    console.error('courses.lesson_update_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `DELETE /v1/courses/lessons/{lessonId}` (08.3-05, PR-5): a soft delete — the row stays with
 * `deleted_at`, its materials rows and every progress row stay (D-408); the lesson leaves every list
 * and its video asset is free for another lesson.
 */
export async function deleteLesson(lessonId: string): Promise<LessonWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'DELETE',
    });
    if (res.ok) return { status: 'ok', lesson: null };
    return await writeRefusal(res, 'lesson_delete');
  } catch (error) {
    console.error('courses.lesson_delete_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/**
 * `PUT /v1/courses/lessons/{lessonId}/materials` (08.3-05, D-410, COURSE-07): the lesson's WHOLE
 * ordered set of materials in one call — `assetIds` in the admin's order, at most 10, each a READY
 * `attachment` of this tenant; `[]` clears. The detail answers with the materials in body order.
 */
export async function replaceMaterials(
  lessonId: string,
  body: MaterialsBody,
): Promise<LessonWriteOutcome> {
  try {
    const res = await apiFetch(`/v1/courses/lessons/${encodeURIComponent(lessonId)}/materials`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    if (res.ok) return { status: 'ok', lesson: lessonDetailSchema.parse(await res.json()) };
    return await writeRefusal(res, 'materials_replace');
  } catch (error) {
    console.error('courses.materials_replace_failed', { error: String(error) });
    return { status: 'error' };
  }
}

/** A material open's answer: the fresh URL, the bare 404, the module being off, a navigation, or a failure. */
export type MaterialUrlOutcome =
  | { status: 'ok'; material: MaterialUrl }
  | { status: 'gone' }
  | { status: 'disabled' }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` (08.3-05, D-410, T-08.3-06): a
 * ten-minute signed URL minted PER CALL. **Never cache, persist or log the answer** — the API
 * answers `Cache-Control: no-store` and this function hands it to exactly one caller, who opens it
 * and drops it. An unknown material, another lesson's or another tenant's is the one bare 404.
 */
export async function materialUrl(
  lessonId: string,
  materialId: string,
): Promise<MaterialUrlOutcome> {
  try {
    const res = await apiFetch(
      `/v1/courses/lessons/${encodeURIComponent(lessonId)}/materials/${encodeURIComponent(materialId)}/url`,
    );
    if (res.ok) return { status: 'ok', material: materialUrlSchema.parse(await res.json()) };
    const error = await apiError(res);
    if (res.status === 404 && error.code === COURSES_MODULE_DISABLED) return { status: 'disabled' };
    if (res.status === 404 || res.status === 400) return { status: 'gone' };
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
    console.error('courses.material_url_failed', { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error('courses.material_url_failed', { error: String(error) });
    return { status: 'error' };
  }
}
