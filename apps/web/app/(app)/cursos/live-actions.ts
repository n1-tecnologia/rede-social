'use server';

import {
  COURSE_ISSUE_SET,
  type CourseIssue,
  type LiveStatus,
  liveInputSchema,
  livePatchSchema,
} from '@rede-social/module-courses/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import { cancelLive, createLive, type LiveWriteOutcome, updateLive } from '@/lib/courses';

/**
 * The live form's writes (08.3-11, D-416, COURSE-11), in the `track-actions.ts` conventions: the
 * SAME Zod the API validates with runs BEFORE any request (a server action is a public endpoint), the
 * id must look like a uuid, every refusal is a CODE the client maps to catalog copy (nothing
 * server-controlled reaches the DOM), a refusal the bootstrap knows navigates OUTSIDE the try/catch
 * (Next 16: `redirect()` throws), and a success revalidates the hub and the live.
 *
 * The codes the form switches on: `start_required`, `duration_invalid`, `url_invalid` (https only,
 * T-08.3-11), `cover_invalid`, `lesson_invalid` (the replay), `replay_too_early`
 * (the row is hidden before the end, so this is a race), `live_cancelled` (a cancel landed first:
 * the form refreshes into its read-only state). No write carries a product link: the product form
 * in the Loja is the only place one is written (D-418). `cancelLiveAction` carries no body: the API sets
 * `cancelled_at` once and answers the same instant to a repeat (P44). Logs carry `{ status, code }`
 * only — a title or a link is tenant content.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a live write answers; `status` is the API's DERIVED one at answer time (D-416). */
export type LiveWriteResult =
  | { ok: true; liveId: string; status: LiveStatus }
  | { ok: false; code: CourseIssue | 'not_found' | 'disabled' | 'generic' };

/** The first closed course issue a local parse refused with, else `generic`. */
function parseRefusal(error: ZodError): LiveWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => COURSE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as CourseIssue | undefined) ?? 'generic' };
}

/** `lib/courses.ts`'s outcome → the form's code, plus the path a bootstrap refusal navigates to. */
function writeResult(outcome: LiveWriteOutcome): {
  result: LiveWriteResult;
  refusal: string | null;
} {
  switch (outcome.status) {
    case 'ok':
      return {
        result: { ok: true, liveId: outcome.live.id, status: outcome.live.status },
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

function revalidateLive(liveId: string) {
  revalidatePath('/cursos');
  revalidatePath(`/cursos/lives/${liveId}`);
}

/** `POST /v1/courses/lives`: the create body parsed with `liveInputSchema` (its defaults fill the rest). */
export async function createLiveAction(input: unknown): Promise<LiveWriteResult> {
  const body = liveInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await createLive(body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLive(result.liveId);
  return result;
}

/** `PATCH /v1/courses/lives/{liveId}`: ONLY the keys the admin changed (no defaults; empty is `patch_empty`). */
export async function updateLiveAction(liveId: string, patch: unknown): Promise<LiveWriteResult> {
  if (typeof liveId !== 'string' || !UUID.test(liveId)) return { ok: false, code: 'generic' };
  const body = livePatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = writeResult(await updateLive(liveId, body.data));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLive(liveId);
  return result;
}

/** `POST /v1/courses/lives/{liveId}/cancel` (D-416): idempotent; never a delete. */
export async function cancelLiveAction(liveId: string): Promise<LiveWriteResult> {
  if (typeof liveId !== 'string' || !UUID.test(liveId)) return { ok: false, code: 'generic' };

  const { result, refusal } = writeResult(await cancelLive(liveId));

  if (refusal) redirect(refusal);
  if (result.ok) revalidateLive(liveId);
  return result;
}
