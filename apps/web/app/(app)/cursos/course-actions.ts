'use server';

import {
  COURSE_ISSUE_SET,
  type CourseIssue,
  type CourseStatus,
  courseInputSchema,
  coursePatchSchema,
  courseStatusBodySchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import {
  type CourseWriteOutcome,
  createCourse,
  setCourseStatus,
  updateCourse,
} from '@/lib/courses';

/**
 * The course form's writes (08.3-07, D-404, D-405, D-412, D-413, COURSE-02, COURSE-08), in the
 * `loja/product-actions.ts` conventions: the SAME Zod the API validates with runs BEFORE any request
 * (a server action is a public endpoint), the id must look like a uuid, every refusal is a CODE the
 * client maps to catalog copy (nothing server-controlled reaches the DOM), a refusal the bootstrap
 * knows navigates OUTSIDE the try/catch (Next 16: `redirect()` throws), and a success revalidates
 * the hub and the course page.
 *
 * Simpler than the store's: the courses API refuses an unknown or foreign cover, photo, category or
 * product BY NAME (`cover_invalid`, `photo_invalid`, `category_invalid`, `product_invalid` — 08.3-04,
 * T-08.3-02), so no bare-404 disambiguation is needed; a bare 404 is always the course itself.
 *
 * `productIds`, when the patch carries it, REPLACES the course's whole link set: this form is the
 * ONE place a course-to-product link is written (D-404, the STORE-03 posture). Logs carry
 * `{ status, code }` only — a title is tenant content (T-08.3-24).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a course write answers. `lessonIds` rides beside `video_not_ready` (a publish refused while
 * a lesson's video processes, D-413) for the course page's notice; `disabled` is the module having
 * been turned off mid-session (the hub's toast copy).
 */
export type CourseWriteResult =
  | { ok: true; courseId: string; status: CourseStatus }
  | {
      ok: false;
      code: CourseIssue | 'not_found' | 'disabled' | 'generic';
      lessonIds?: string[];
    };

/** The first closed course issue a local parse refused with, else `generic`. */
function parseRefusal(error: ZodError): CourseWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

/** `lib/courses.ts`'s outcome → the form's code, plus the path a bootstrap refusal navigates to. */
function writeResult(outcome: CourseWriteOutcome): {
  result: CourseWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return {
        result: { ok: true, courseId: outcome.course.id, status: outcome.course.status },
        refusal: null,
      };
    case 'issue': {
      const raw = outcome.details?.lessonIds;
      const lessonIds = Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === 'string')
        : undefined;
      return {
        result: {
          ok: false,
          code: outcome.issue,
          ...(lessonIds && lessonIds.length > 0 ? { lessonIds } : {}),
        },
        refusal: null,
      };
    }
    case 'gone':
      return { result: { ok: false, code: 'not_found' }, refusal: null };
    case 'disabled':
      return { result: { ok: false, code: 'disabled' }, refusal: null };
    case 'redirect':
      return { result: { ok: false, code: 'generic' }, refusal: outcome.path };
    default:
      return { result: { ok: false, code: 'generic' }, refusal: null };
  }
}

function revalidateCourse(courseId: string) {
  revalidatePath('/cursos');
  revalidatePath(`/cursos/${courseId}`);
}

/**
 * `POST /v1/courses` (COURSE-02): the create body parsed with `courseInputSchema` (its defaults fill
 * every omitted optional field; `productIds` is a set), the API re-validates, the detail answers.
 */
export async function createCourseAction(input: unknown): Promise<CourseWriteResult> {
  const body = courseInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createCourse(body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(result.courseId);
  return result;
}

/**
 * `PATCH /v1/courses/{courseId}` (COURSE-08, D-404): ONLY the keys the admin changed, parsed with
 * the patch contract (no defaults: an omitted key leaves its column alone; an empty patch is
 * `patch_empty`). `productIds`, when present, replaces the whole link set.
 */
export async function updateCourseAction(
  courseId: string,
  patch: unknown,
): Promise<CourseWriteResult> {
  if (typeof courseId !== 'string' || !UUID.test(courseId)) return { ok: false, code: 'generic' };
  const body = coursePatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateCourse(courseId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}

/**
 * `PUT /v1/courses/{courseId}/status` (D-413, COURSE-03): idempotent publish, unpublish and
 * archive. The form uses it for "Arquivar curso"; the course page (plan 08) for publish and
 * unpublish, where `video_not_ready` carries the blocking `lessonIds`.
 */
export async function setCourseStatusAction(
  courseId: string,
  status: CourseStatus,
): Promise<CourseWriteResult> {
  if (typeof courseId !== 'string' || !UUID.test(courseId)) return { ok: false, code: 'generic' };
  const body = courseStatusBodySchema.safeParse({ status });
  if (!body.success) return { ok: false, code: 'generic' };

  const { result, refusal } = writeResult(await setCourseStatus(courseId, body.data.status));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}
