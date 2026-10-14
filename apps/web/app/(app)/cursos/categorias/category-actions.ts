'use server';

import {
  type Category,
  COURSE_ISSUE_SET,
  type CourseIssue,
  categoryInputSchema,
  categoryPatchSchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import {
  type CategoryWriteOutcome,
  createCategory,
  deleteCategory,
  updateCategory,
} from '@/lib/courses';

/**
 * The category manager's writes (08.3-07, D-411, COURSE-04), in the `course-actions.ts` shape: the
 * SAME Zod the API validates with runs BEFORE any request, the id must look like a uuid, every
 * refusal is a CODE the client maps to catalog copy, a refusal the bootstrap knows navigates
 * OUTSIDE the try/catch (Next 16: `redirect()` throws), and a success revalidates the manager and
 * the hub (whose "Categorias" row counts them).
 *
 * Two 409s are the normal path, not failures: `category_exists` (a name already used, ignoring
 * case) and `category_in_use` (a removal while any course — archived ones included — references
 * the category; `courseCount` rides beside it so the toast can say the number the manager's stale
 * row did not). Logs carry `{ status, code }` only — a name is tenant content (T-08.3-24).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a category write answers; `category` is null after a removal. */
export type CategoryWriteResult =
  | { ok: true; category: Category | null }
  | {
      ok: false;
      code: CourseIssue | 'not_found' | 'disabled' | 'generic';
      /** Beside `category_in_use`: how many courses still reference the category. */
      courseCount?: number;
    };

function parseRefusal(error: ZodError): CategoryWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

function writeResult(outcome: CategoryWriteOutcome): {
  result: CategoryWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return { result: { ok: true, category: outcome.category }, refusal: null };
    case 'issue': {
      const raw = outcome.details?.courseCount;
      return {
        result: {
          ok: false,
          code: outcome.issue,
          ...(typeof raw === 'number' ? { courseCount: raw } : {}),
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

function revalidateCategories() {
  revalidatePath('/cursos/categorias');
  revalidatePath('/cursos');
}

/** `POST /v1/courses/categories`: a name (60) and an optional cover; `409 category_exists`. */
export async function createCategoryAction(input: unknown): Promise<CategoryWriteResult> {
  const body = categoryInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createCategory(body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCategories();
  return result;
}

/** `PATCH /v1/courses/categories/{categoryId}`: only the keys the admin changed. */
export async function updateCategoryAction(
  categoryId: string,
  patch: unknown,
): Promise<CategoryWriteResult> {
  if (typeof categoryId !== 'string' || !UUID.test(categoryId)) {
    return { ok: false, code: 'generic' };
  }
  const body = categoryPatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateCategory(categoryId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCategories();
  return result;
}

/**
 * `DELETE /v1/courses/categories/{categoryId}` (D-411): 204 for an empty category;
 * `409 category_in_use { courseCount }` while any course references it (the manager disables the
 * control before the tap; this is the stale-count path).
 */
export async function deleteCategoryAction(categoryId: string): Promise<CategoryWriteResult> {
  if (typeof categoryId !== 'string' || !UUID.test(categoryId)) {
    return { ok: false, code: 'generic' };
  }

  const { result, refusal } = writeResult(await deleteCategory(categoryId));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateCategories();
  return result;
}
