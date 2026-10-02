'use server';

import { type AdminRules, adminRulesSchema, rulesBodySchema } from '@rede-social/contracts/rules';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The Regras screen's server action on the TENANT LANE (ADMIN-03, D-341, UI-D-280, UI-D-284).
 *
 * The SAME Zod the API runs (`rulesBodySchema`: CRLF to LF, trimmed, required, at most 10,000 UTF-16
 * code units) validates before any request, so an empty or over-cap draft never leaves the server
 * tier. The request carries the text only: no tenant id, no version (the API acts on the caller's
 * membership of record and decides the version itself).
 *
 * Results are typed, never a throw for an expected refusal: `required` / `tooLong` are field errors,
 * `forbidden` (403 `FORBIDDEN`, the permission was lost in another tab) is the editor's toast plus a
 * refresh into the page's `notFound()`, and anything else is `failed` (the editor toasts and keeps the
 * draft). Session and membership refusals follow the shipped `(app)` navigation, OUTSIDE the
 * try/catch (Next 16: `redirect()` throws). The rules text never reaches a log line.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type SaveRulesResult =
  | { ok: true; rules: AdminRules }
  | { ok: false; code: 'required' | 'tooLong' | 'forbidden' | 'failed' };

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

/** `PUT /v1/admin/rules`: saves the draft; the version rises only when the text changed (D-341). */
export async function saveRulesAction(rulesText: string): Promise<SaveRulesResult> {
  const body = rulesBodySchema.safeParse({ rulesText });
  if (!body.success) {
    const tooLong = body.error.issues.some((issue) => issue.message === 'too_long');
    return { ok: false, code: tooLong ? 'tooLong' : 'required' };
  }

  let refusal: string | null = null;
  let result: SaveRulesResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch('/v1/admin/rules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true, rules: adminRulesSchema.parse(await res.json()) };
      // The Regras page re-reads the version on the next navigation.
      revalidatePath('/configuracoes/regras');
    } else {
      const envelope = await readEnvelope(res);
      const reason = envelope?.details?.rulesText;
      if (res.status === 400 && reason === 'too_long') result = { ok: false, code: 'tooLong' };
      else if (res.status === 400 && reason === 'required') {
        result = { ok: false, code: 'required' };
      } else if (res.status === 403 && envelope?.code === 'FORBIDDEN') {
        result = { ok: false, code: 'forbidden' };
      } else {
        const error = new ApiClientError(
          res.status,
          envelope?.code ?? 'HTTP_ERROR',
          envelope?.details,
          envelope?.requestId,
        );
        refusal = res.status === 401 || res.status === 403 ? bootstrapRedirectPath(error) : null;
        if (!refusal) {
          console.error('admin.rules.save_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('admin.rules.save_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
