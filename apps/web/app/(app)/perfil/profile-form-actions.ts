'use server';

import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The profile's server action for the "Há perguntas novas" notice (12-14, D-586, UI-D-589; PFORM-16).
 *
 * `POST /v1/me/profile-form/dismiss-notice` is "Agora não" stored ON THE SERVER, so the dismissal
 * survives a reinstall and every other device. Batch granularity: it clears every optional question that
 * exists now, and a later new optional question brings the notice back. The result is typed, never a
 * throw for an expected failure: the notice restores itself and toasts on `{ ok: false }`. A session or
 * membership refusal follows the shipped navigation, OUTSIDE the try/catch (Next 16: `redirect()` throws).
 *
 * The body carries nothing and no log line carries more than a status.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type DismissNoticeActionResult = { ok: true } | { ok: false };

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

export async function dismissNoticeAction(): Promise<DismissNoticeActionResult> {
  let refusal: string | null = null;
  let result: DismissNoticeActionResult = { ok: false };
  try {
    const res = await apiFetch('/v1/me/profile-form/dismiss-notice', { method: 'POST' });
    if (res.ok) {
      result = { ok: true };
    } else {
      const envelope = await readEnvelope(res);
      if (res.status === 401 || res.status === 403) {
        refusal = bootstrapRedirectPath(
          new ApiClientError(
            res.status,
            envelope?.code ?? 'HTTP_ERROR',
            envelope?.details,
            envelope?.requestId,
          ),
        );
      }
      if (!refusal) {
        console.error('profile_form.dismiss_failed', { status: res.status, code: envelope?.code });
      }
    }
  } catch (error) {
    console.error('profile_form.dismiss_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  if (refusal) redirect(refusal);
  return result;
}
