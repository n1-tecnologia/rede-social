'use server';

import {
  COURSE_ISSUE_SET,
  type CourseIssue,
  reorderTrackCoursesSchema,
  type TrackStatus,
  trackInputSchema,
  trackPatchSchema,
  trackStatusBodySchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import {
  createTrack,
  replaceTrackCourses,
  setTrackStatus,
  type TrackWriteOutcome,
  updateTrack,
} from '@/lib/courses';

/**
 * The track form's writes (08.3-10, D-414, D-415, COURSE-10), in the `course-actions.ts`
 * conventions: the SAME Zod the API validates with runs BEFORE any request (a server action is a
 * public endpoint), the id must look like a uuid, every refusal is a CODE the client maps to catalog
 * copy (nothing server-controlled reaches the DOM), a refusal the bootstrap knows navigates OUTSIDE
 * the try/catch (Next 16: `redirect()` throws), and a success revalidates the hub and the track.
 *
 * `replaceTrackCoursesAction` is the ONE write path of a track's membership and order (D-414, A8):
 * the form sends the WHOLE list of its PUBLISHED rows after the create or the patch. The API refuses
 * a draft, archived, unknown or foreign course BY NAME (`course_invalid`, T-08.3-02), so a bare 404
 * is always the track itself. Logs carry `{ status, code }` only — a title is tenant content.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a track write answers; `disabled` is the module having been turned off mid-session. */
export type TrackWriteResult =
  | { ok: true; trackId: string; status: TrackStatus }
  | { ok: false; code: CourseIssue | 'not_found' | 'disabled' | 'generic' };

/** The first closed course issue a local parse refused with, else `generic`. */
function parseRefusal(error: ZodError): TrackWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

/** `lib/courses.ts`'s outcome → the form's code, plus the path a bootstrap refusal navigates to. */
function writeResult(outcome: TrackWriteOutcome): {
  result: TrackWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return {
        result: { ok: true, trackId: outcome.track.id, status: outcome.track.status },
        refusal: null,
      };
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

function revalidateTrack(trackId: string) {
  revalidatePath('/cursos');
  revalidatePath(`/cursos/trilhas/${trackId}`);
}

/** `POST /v1/courses/tracks`: the create body parsed with `trackInputSchema` (its defaults fill the rest). */
export async function createTrackAction(input: unknown): Promise<TrackWriteResult> {
  const body = trackInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createTrack(body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateTrack(result.trackId);
  return result;
}

/** `PATCH /v1/courses/tracks/{trackId}`: ONLY the keys the admin changed (no defaults; empty is `patch_empty`). */
export async function updateTrackAction(
  trackId: string,
  patch: unknown,
): Promise<TrackWriteResult> {
  if (typeof trackId !== 'string' || !UUID.test(trackId)) return { ok: false, code: 'generic' };
  const body = trackPatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateTrack(trackId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateTrack(trackId);
  return result;
}

/** `PUT /v1/courses/tracks/{trackId}/status` (D-415): idempotent archive and reactivate. */
export async function setTrackStatusAction(
  trackId: string,
  status: TrackStatus,
): Promise<TrackWriteResult> {
  if (typeof trackId !== 'string' || !UUID.test(trackId)) return { ok: false, code: 'generic' };
  const body = trackStatusBodySchema.safeParse({ status });
  if (!body.success) return { ok: false, code: 'generic' };

  const { result, refusal } = writeResult(await setTrackStatus(trackId, body.data.status));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateTrack(trackId);
  return result;
}

/**
 * `PUT /v1/courses/tracks/{trackId}/order { ids }` (D-414, COURSE-10): the track's WHOLE course list
 * in order — membership and order in one body; `[]` clears. `reorderTrackCoursesSchema` runs first
 * (a duplicate or a non-uuid never reaches the API); `course_invalid` comes back as its own code so
 * the form can toast the sentence and keep the list.
 */
export async function replaceTrackCoursesAction(
  trackId: string,
  ids: unknown,
): Promise<TrackWriteResult> {
  if (typeof trackId !== 'string' || !UUID.test(trackId)) return { ok: false, code: 'generic' };
  const body = reorderTrackCoursesSchema.safeParse({ ids });
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await replaceTrackCourses(trackId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateTrack(trackId);
  return result;
}
