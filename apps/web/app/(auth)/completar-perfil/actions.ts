'use server';

import {
  type MemberForm,
  memberFormSchema,
  PROFILE_FORM_ISSUE_SET,
  type ProfileFormIssue,
  saveAnswersBodySchema,
  saveAnswersResultSchema,
} from '@rede-social/contracts/profile-form';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { safeNextPath } from '@/lib/safe-next-path';

/**
 * The completion screen's save (12-12, D-583, UI-D-586, UI-D-587; T-12-29, T-12-30).
 *
 * `PUT /v1/me/profile-form/answers` carries the whole screen at once. The result is typed, never a throw
 * for an expected refusal: `invalid` is the API's 400 `answers_invalid` with the errors keyed by question
 * id, `changed` is its 409 `form_changed` with the fresh form (nothing was written), `failed` is anything
 * else. A session or membership refusal follows the shipped navigation, OUTSIDE the try/catch (Next 16:
 * `redirect()` throws).
 *
 * **12.1 (D-629, D-631): the server decides when the member is done.** A save with a `stepId` stores that step;
 * the answer says how many visible required questions are still unanswered and which ones. Only
 * `missingRequired === 0` returns the destination; otherwise the result is `destination: null` with the ids, and
 * the screen moves to the next step or jumps to the first step that holds one of them.
 *
 * **The destination has one source (T-12-29).** `next` is attacker-controlled; the client never reads it
 * for navigation and only goes where this action says. `safeNextPath` (same-origin relative path, no
 * `//`, no scheme, the form and the `(auth)` screens excluded) decides; an invalid or missing value
 * falls back silently to `/inicio` (`/perfil` in edit mode) and is never echoed.
 *
 * **No answer is logged or put in a message (T-12-30).** Only a status and a code are written.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type SaveProfileFormMode = 'first' | 'returning' | 'edit';

export type SaveProfileFormInput = {
  formEtag: string;
  /** The step being saved (12.1, D-629); absent keeps the whole-form save of Phase 12. */
  stepId?: string;
  answers: Record<string, unknown>;
  next?: string | null;
  mode: SaveProfileFormMode;
};

export type SaveProfileFormResult =
  | { ok: true; destination: string }
  /** The save worked but the gate still reports visible required questions: no destination yet (D-629, D-631). */
  | { ok: true; destination: null; missingQuestionIds: string[] }
  | { ok: false; code: 'invalid'; errors: Record<string, ProfileFormIssue> }
  | { ok: false; code: 'changed'; form: MemberForm }
  | { ok: false; code: 'failed' };

type Envelope = {
  error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
};

async function readEnvelope(res: Response): Promise<Envelope['error'] | null> {
  try {
    const body = (await res.json()) as Envelope;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** Keeps only the closed refusal vocabulary: nothing else the body carries reaches the client. */
function keyedErrors(details: unknown): Record<string, ProfileFormIssue> | null {
  if (typeof details !== 'object' || details === null) return null;
  const errors: Record<string, ProfileFormIssue> = {};
  for (const [id, issue] of Object.entries(details)) {
    if (typeof issue === 'string' && PROFILE_FORM_ISSUE_SET.has(issue)) {
      errors[id] = issue as ProfileFormIssue;
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export async function saveProfileFormAction(
  input: SaveProfileFormInput,
): Promise<SaveProfileFormResult> {
  const body = saveAnswersBodySchema.safeParse({
    formEtag: input.formEtag,
    stepId: input.stepId,
    answers: input.answers,
  });
  if (!body.success) return { ok: false, code: 'failed' };

  let refusal: string | null = null;
  let result: SaveProfileFormResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch('/v1/me/profile-form/answers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      // A module turned off meanwhile answers 200 as a no-op: the member continues as on success.
      const fallback = input.mode === 'edit' ? '/perfil' : '/inicio';
      const pending = saveAnswersResultSchema.safeParse(await res.json().catch(() => null));
      result =
        pending.success && pending.data.missingRequired > 0
          ? { ok: true, destination: null, missingQuestionIds: pending.data.missingQuestionIds }
          : { ok: true, destination: safeNextPath(input.next) ?? fallback };
    } else {
      const envelope = await readEnvelope(res);
      const reason = envelope?.details?.profileForm;
      if (res.status === 400 && reason === 'answers_invalid') {
        const errors = keyedErrors(envelope?.details?.errors);
        if (errors) result = { ok: false, code: 'invalid', errors };
      } else if (res.status === 409 && reason === 'form_changed') {
        const form = memberFormSchema.safeParse(envelope?.details?.form);
        if (form.success) result = { ok: false, code: 'changed', form: form.data };
      } else if (res.status === 401 || res.status === 403) {
        const error = new ApiClientError(
          res.status,
          envelope?.code ?? 'HTTP_ERROR',
          envelope?.details,
          envelope?.requestId,
        );
        refusal = bootstrapRedirectPath(error);
      }
      if (!result.ok && !refusal && result.code === 'failed') {
        console.error('profile_form.save_failed', { status: res.status, code: envelope?.code });
      }
    }
  } catch (error) {
    console.error('profile_form.save_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
