'use server';

import { reorderBodySchema } from '@rede-social/contracts/profile-form';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The builder's server actions on the TENANT LANE (12-15, D-582, D-585, D-588, UI-D-567, UI-D-576,
 * UI-D-578; T-12-33, T-12-34).
 *
 * Every action calls a route behind the API's guard chain (`requireAuth`, `requireModule`,
 * `profile_form.manage`), which is the real control; the actions only translate its answers. Results
 * are typed, never a throw for an expected refusal, with one closed vocabulary of codes:
 *
 *  - `forbidden`: 403 `FORBIDDEN` (the permission was lost in another tab): the shipped forbidden toast
 *    plus a refresh into the page's `notFound()`.
 *  - `moduleOff`: 404 `MODULE_DISABLED` (a `super_admin` turned the module off): its own toast plus the
 *    same refresh.
 *  - `mismatch`: 409 `order_mismatch` (the list changed under the admin): refresh and the failed sentence.
 *  - `limit`: 409 `limit_reached` (30 active questions): the limit sentence.
 *  - `failed`: anything else.
 *
 * Session and membership refusals follow the shipped `(app)` navigation, OUTSIDE the try/catch (Next 16:
 * `redirect()` throws). Only a status and a code reach a log line, never a title or an answer.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type BuilderRefusal = 'forbidden' | 'moduleOff' | 'mismatch' | 'limit' | 'failed';

export type ReorderResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'moduleOff' | 'mismatch' | 'failed' };

type ErrorBody = { code?: string; details?: Record<string, unknown>; requestId?: string };
type Envelope = { error?: ErrorBody };

async function readEnvelope(res: Response): Promise<ErrorBody | null> {
  try {
    const body = (await res.json()) as Envelope;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** The closed vocabulary a refusal of the builder API maps to, or `null` for anything else. */
function refusalOf(status: number, envelope: ErrorBody | null): BuilderRefusal | null {
  if (status === 404 && envelope?.code === 'MODULE_DISABLED') return 'moduleOff';
  if (status === 403 && envelope?.code === 'FORBIDDEN') return 'forbidden';
  const detail = envelope?.details?.profileForm;
  if (status === 409 && detail === 'order_mismatch') return 'mismatch';
  if (status === 409 && detail === 'limit_reached') return 'limit';
  return null;
}

/** The `(app)` navigation for a session or membership refusal, or `null` when it is not one. */
function navigationFor(status: number, envelope: ErrorBody | null): string | null {
  if (status !== 401 && status !== 403) return null;
  return bootstrapRedirectPath(
    new ApiClientError(
      status,
      envelope?.code ?? 'HTTP_ERROR',
      envelope?.details,
      envelope?.requestId,
    ),
  );
}

/**
 * `PUT /v1/profile_form/order`: stores the WHOLE active list in the given order (D-582). The body is the
 * contract's, validated here first, so a malformed list never leaves the server tier. The API answers
 * `order_mismatch` when the ids are not exactly the active set, and renumbers the list in one statement.
 */
export async function reorderQuestionsAction(ids: string[]): Promise<ReorderResult> {
  const body = reorderBodySchema.safeParse({ ids });
  if (!body.success) return { ok: false, code: 'failed' };

  let refusal: string | null = null;
  let result: ReorderResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch('/v1/profile_form/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true };
    } else {
      const envelope = await readEnvelope(res);
      const code = refusalOf(res.status, envelope);
      if (code === 'forbidden' || code === 'moduleOff' || code === 'mismatch') {
        result = { ok: false, code };
      } else {
        refusal = navigationFor(res.status, envelope);
        if (!refusal) {
          console.error('profile_form.reorder_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('profile_form.reorder_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  if (refusal) redirect(refusal);
  return result;
}
