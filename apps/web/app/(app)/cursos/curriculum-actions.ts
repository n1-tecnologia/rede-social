'use server';

import {
  COURSE_ISSUE_SET,
  COURSE_MAX_ORDER,
  type CourseIssue,
  type LessonView,
  type ModuleView,
  moduleInputSchema,
  modulePatchSchema,
  reorderIdsSchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import {
  createModule,
  deleteModule,
  type ModuleWriteOutcome,
  type ReorderOutcome,
  reorderLessons,
  reorderModules,
  updateModule,
} from '@/lib/courses';

/**
 * The curriculum editor's writes (08.3-08, D-406, D-414, COURSE-05, COURSE-06), in the
 * `course-actions.ts` conventions: the SAME Zod the API validates with runs BEFORE any request (a
 * server action is a public endpoint — a duplicated or oversized order never leaves the BFF), every
 * id must look like a uuid, every refusal is a CODE the client maps to catalog copy (nothing
 * server-controlled reaches the DOM), a refusal the bootstrap knows navigates OUTSIDE the try/catch
 * (Next 16: `redirect()` throws), and a success revalidates the course page and the hub (whose row
 * counts the modules and lessons).
 *
 * **Reorder is a whole-order write** (UI-D-397, the communities rule): `ids` is the parent's EVERY
 * live child once, in the new order. `409 order_stale` is its own code — the set changed under the
 * admin (a module or lesson added or removed since the page rendered, T-08.3-10) — because the
 * editor's answer to it differs from a failure: it refreshes the list rather than keeping the draft.
 *
 * The module routes are addressed by `moduleId` alone; `courseId` travels with every action so the
 * course page it belongs to can be revalidated. Logs carry `{ status, code }` only — a title is
 * tenant content (T-08.3-24).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The whole-order body of both parents: 1..200 uuids, each once. */
const reorderBodySchema = reorderIdsSchema(COURSE_MAX_ORDER);

/** What a module write answers; `module` is null after a removal. */
export type ModuleWriteResult =
  | { ok: true; module: ModuleView | null }
  | { ok: false; code: CourseIssue | 'not_found' | 'disabled' | 'generic' };

/** What a whole-order write answers: the parent's children in the new order, or why not. */
export type ReorderResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; code: 'order_stale' | 'generic' };

function parseRefusal(error: ZodError): ModuleWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

function writeResult(outcome: ModuleWriteOutcome): {
  result: ModuleWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return { result: { ok: true, module: outcome.module }, refusal: null };
    case 'issue':
      return { result: { ok: false, code: outcome.issue }, refusal: null };
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

/**
 * `409 { courses: 'order_stale' }` is the one closed code of a reorder; everything else is `generic`
 * (a 403, a 404 for the parent, a network failure). The communities' `orderRefusal` shape.
 */
function orderRefusal<T>(outcome: ReorderOutcome<T>): {
  result: ReorderResult<T>;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return { result: { ok: true, items: outcome.items }, refusal: null };
    case 'issue':
      return {
        result: { ok: false, code: outcome.issue === 'order_stale' ? 'order_stale' : 'generic' },
        refusal: null,
      };
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

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * `POST /v1/courses/{courseId}/modules` (COURSE-05): the create body parsed with
 * `moduleInputSchema` (its defaults fill the summary and the flag); the API re-validates and answers
 * the module at the course's next position. `requiresPrevious` is forced off on the first (D-406).
 */
export async function createModuleAction(
  courseId: string,
  input: unknown,
): Promise<ModuleWriteResult> {
  if (!isUuid(courseId)) return { ok: false, code: 'generic' };
  const body = moduleInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createModule(courseId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}

/**
 * `PATCH /v1/courses/modules/{moduleId}` (COURSE-05): ONLY the keys the admin changed, parsed with
 * the patch contract (an empty patch is `patch_empty`).
 */
export async function updateModuleAction(
  courseId: string,
  moduleId: string,
  patch: unknown,
): Promise<ModuleWriteResult> {
  if (!isUuid(courseId) || !isUuid(moduleId)) return { ok: false, code: 'generic' };
  const body = modulePatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateModule(moduleId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}

/**
 * `DELETE /v1/courses/modules/{moduleId}` (COURSE-05, PR-5): "Remover módulo" — a soft delete; the
 * lessons and the progress rows stay (D-408). A second call is the bare 404 (`not_found`).
 */
export async function deleteModuleAction(
  courseId: string,
  moduleId: string,
): Promise<ModuleWriteResult> {
  if (!isUuid(courseId) || !isUuid(moduleId)) return { ok: false, code: 'generic' };

  const { result, refusal } = writeResult(await deleteModule(moduleId));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}

/**
 * `PUT /v1/courses/{courseId}/modules/order` (D-414, UI-D-397): the course's EVERY live module once,
 * in the new order, written after ONE arrow tap. The answer is the modules in that order, so the
 * editor re-seeds its draft from the server's truth.
 */
export async function reorderModulesAction(
  courseId: string,
  ids: unknown,
): Promise<ReorderResult<ModuleView>> {
  if (!isUuid(courseId)) return { ok: false, code: 'generic' };
  const body = reorderBodySchema.safeParse({ ids });
  if (!body.success) return { ok: false, code: 'generic' };

  const { result, refusal } = orderRefusal(await reorderModules(courseId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}

/**
 * `PUT /v1/courses/modules/{moduleId}/lessons/order` (D-414, UI-D-397): the module's EVERY live
 * lesson once, in the new order, written after ONE arrow tap; the answer is the lessons in that order.
 */
export async function reorderLessonsAction(
  courseId: string,
  moduleId: string,
  ids: unknown,
): Promise<ReorderResult<LessonView>> {
  if (!isUuid(courseId) || !isUuid(moduleId)) return { ok: false, code: 'generic' };
  const body = reorderBodySchema.safeParse({ ids });
  if (!body.success) return { ok: false, code: 'generic' };

  const { result, refusal } = orderRefusal(await reorderLessons(moduleId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCourse(courseId);
  return result;
}
