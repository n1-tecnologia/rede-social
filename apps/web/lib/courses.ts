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
} from '@rede-social/module-courses/contracts';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

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
