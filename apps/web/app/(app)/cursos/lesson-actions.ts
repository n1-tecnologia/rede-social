'use server';

import type { MediaStatus } from '@rede-social/contracts/media';
import {
  COURSE_ISSUE_SET,
  type CourseIssue,
  type LessonDetail,
  type LessonView,
  lessonInputSchema,
  lessonPatchSchema,
  materialsBodySchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import {
  createLesson,
  deleteLesson,
  type LessonWriteOutcome,
  materialUrl,
  replaceMaterials,
  updateLesson,
} from '@/lib/courses';
import { getMediaAsset } from '@/lib/media';

/**
 * The lesson form's writes (08.3-09, D-407, D-409, D-410, COURSE-06, COURSE-07), in the
 * `course-actions.ts` / `curriculum-actions.ts` conventions: the SAME Zod the API validates with runs
 * BEFORE any request (a server action is a public endpoint — an eleventh material or a typed
 * `durationSeconds` never leaves the BFF), every id must look like a uuid, every refusal is a CODE
 * the client maps to catalog copy (nothing server-controlled reaches the DOM), a refusal the
 * bootstrap knows navigates OUTSIDE the try/catch (Next 16: `redirect()` throws), and a success
 * revalidates the hub, the course page and the lesson route.
 *
 * **No upload byte passes here** (MEDIA-01, PR-7): the video went browser → provider through UpChunk
 * and every material browser → Storage through its signed URL; these actions carry ASSET IDS only.
 *
 * **The material URL is never logged** (T-08.3-06): `materialUrlAction` hands a ten-minute bearer
 * capability to exactly one tab; the log line, when any, carries the material id.
 *
 * The lesson routes are addressed by `lessonId` alone; `courseId` travels with every action so the
 * course page the lesson belongs to can be revalidated by path (the plan 08 decision). Logs carry
 * `{ status, code }` only — a title or a file name is tenant content (T-08.3-24).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** What a lesson write answers: the view (create), the detail (edit, materials), null (remove). */
export type LessonWriteResult =
  | { ok: true; lesson: LessonView | LessonDetail | null }
  | { ok: false; code: CourseIssue | 'not_found' | 'disabled' | 'generic' };

/** The first closed course issue a local parse refused with, else `generic`. */
function parseRefusal(error: ZodError): LessonWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

function writeResult(outcome: LessonWriteOutcome): {
  result: LessonWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return { result: { ok: true, lesson: outcome.lesson }, refusal: null };
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

function revalidateLesson(courseId: string, lessonId: string | null) {
  revalidatePath('/cursos');
  revalidatePath(`/cursos/${courseId}`);
  if (lessonId) revalidatePath(`/cursos/${courseId}/aulas/${lessonId}`);
}

/**
 * `POST /v1/courses/modules/{moduleId}/lessons` (COURSE-06, D-409): the create body parsed with
 * `lessonInputSchema` (its defaults fill the description, the video and the flag; `videoUrl` or a
 * typed duration is refused as an unknown key, PR-6); the API re-validates and answers the lesson at
 * the module's next position. `requiresPrevious` (08.5-10, D-428) passes through unchanged: the
 * server forces it off on the course's first lesson and on a free one, whatever the body says
 * (T-08.5-14).
 */
export async function createLessonAction(
  courseId: string,
  moduleId: string,
  input: unknown,
): Promise<LessonWriteResult> {
  if (!isUuid(courseId) || !isUuid(moduleId)) return { ok: false, code: 'generic' };
  const body = lessonInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createLesson(moduleId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLesson(courseId, result.lesson?.id ?? null);
  return result;
}

/**
 * `PATCH /v1/courses/lessons/{lessonId}` (COURSE-06): ONLY the keys the admin changed, parsed with
 * the patch contract (an empty patch is `patch_empty`); `videoAssetId: null` detaches the video and
 * `requiresPrevious` (D-428) passes through as the form sent it (the server rule stays the authority).
 */
export async function updateLessonAction(
  courseId: string,
  lessonId: string,
  patch: unknown,
): Promise<LessonWriteResult> {
  if (!isUuid(courseId) || !isUuid(lessonId)) return { ok: false, code: 'generic' };
  const body = lessonPatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateLesson(lessonId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLesson(courseId, lessonId);
  return result;
}

/**
 * `DELETE /v1/courses/lessons/{lessonId}` (COURSE-06, PR-5): "Remover aula" — a soft delete; the
 * materials rows and the progress rows stay (D-408). A second call is the bare 404 (`not_found`).
 */
export async function deleteLessonAction(
  courseId: string,
  lessonId: string,
): Promise<LessonWriteResult> {
  if (!isUuid(courseId) || !isUuid(lessonId)) return { ok: false, code: 'generic' };

  const { result, refusal } = writeResult(await deleteLesson(lessonId));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLesson(courseId, lessonId);
  return result;
}

/**
 * `PUT /v1/courses/lessons/{lessonId}/materials` (COURSE-07, D-410): the lesson's WHOLE ordered set
 * — every `assetId` once, at most 10, in the admin's order (`[]` clears) — parsed with
 * `materialsBodySchema` first, so an eleventh file is refused here as `too_many_materials`.
 */
export async function replaceMaterialsAction(
  courseId: string,
  lessonId: string,
  assetIds: unknown,
): Promise<LessonWriteResult> {
  if (!isUuid(courseId) || !isUuid(lessonId)) return { ok: false, code: 'generic' };
  const body = materialsBodySchema.safeParse({ assetIds });
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await replaceMaterials(lessonId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLesson(courseId, lessonId);
  return result;
}

/** What opening a material answers: the fresh URL (and when it dies), or why not. */
export type MaterialUrlResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; code: 'not_found' | 'disabled' | 'generic' };

/**
 * `GET /v1/courses/lessons/{lessonId}/materials/{materialId}/url` (COURSE-07, D-410, T-08.3-06): a
 * ten-minute signed URL minted for THIS tap. The value crosses to the client once, is opened in a
 * new tab and dropped; it is never cached, persisted, revalidated into or logged (the API answers
 * `Cache-Control: no-store`). A refusal is a code; the raw error never reaches the screen.
 */
export async function materialUrlAction(
  lessonId: string,
  materialId: string,
): Promise<MaterialUrlResult> {
  if (!isUuid(lessonId) || !isUuid(materialId)) return { ok: false, code: 'generic' };

  const outcome = await materialUrl(lessonId, materialId);
  if (outcome.status === 'redirect') redirect(outcome.path);
  switch (outcome.status) {
    case 'ok':
      return { ok: true, url: outcome.material.url, expiresAt: outcome.material.expiresAt };
    case 'gone':
      return { ok: false, code: 'not_found' };
    case 'disabled':
      return { ok: false, code: 'disabled' };
    default:
      return { ok: false, code: 'generic' };
  }
}

const assetIdSchema = z.uuid();

/** What a lesson video read answers: the asset's status and its measured seconds (ready only). */
export type LessonVideoResult =
  | { ok: true; status: MediaStatus; durationSeconds: number | null }
  | { ok: false; code: 'not_found' | 'generic' };

/**
 * The lesson video's status AND its measured `durationSeconds`, read from the asset row the moment
 * the readiness poll says `ready` (D-409: the "mm:ss" caption is the ASSET'S number, never typed, and
 * `useAssetReadiness`'s own read answers the status alone). Read-only: it revalidates nothing. A 404
 * is an expected outcome (the video was removed); a session refusal navigates; anything else is
 * logged and answered `generic`.
 */
export async function lessonVideoAction(assetId: string): Promise<LessonVideoResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LessonVideoResult = { ok: false, code: 'generic' };
  try {
    const asset = await getMediaAsset(id.data);
    result = { ok: true, status: asset.status, durationSeconds: asset.durationSeconds };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      result = { ok: false, code: 'not_found' };
    } else {
      if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
      if (!refusal) console.error('courses.lesson_video_read_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}
