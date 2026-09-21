'use server';

import { updateProfileBodySchema } from '@tria/contracts/profiles';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * Server actions of the member's own profile (PROF-01), in the `marca/actions.ts` conventions:
 * validate with the SAME Zod the API runs BEFORE the request, `apiFetch` to the 03-02 routes, typed
 * results that never throw for an EXPECTED refusal, `revalidatePath` after every mutation, and a
 * 401/403 turned into a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws).
 *
 * Every refusal is answered with a catalog KEY, never a translated string and never a function — a
 * function cannot cross the server→client prop boundary (02-12), and a string would put pt-BR copy
 * in a server module instead of in `messages/pt-BR/profile.json`.
 */

type Envelope = { error?: { code?: string; details?: Record<string, unknown> } };

async function readEnvelope(res: Response): Promise<Envelope['error'] | null> {
  try {
    const body = (await res.json()) as Envelope;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** The redirect a 401/403 answer maps to, `null` for anything else. */
function refusalPath(status: number, envelope: Envelope['error'] | null): string | null {
  if (status !== 401 && status !== 403) return null;
  return bootstrapRedirectPath(
    new ApiClientError(status, envelope?.code ?? 'HTTP_ERROR', envelope?.details),
  );
}

/** Both profile screens read the same row, so both are revalidated after every mutation. */
function revalidateProfile(): void {
  revalidatePath('/perfil');
  revalidatePath('/perfil/editar');
}

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; code: 'nameRequired' | 'nameTooLong' | 'bioTooLong' | 'generic' };

/** The per-field refusal vocabulary of 03-02 (`PROFILE_ISSUES`) mapped to catalog keys. */
function profileIssueCode(details: Record<string, unknown> | undefined): SaveProfileResult {
  if (details?.displayName === 'required') return { ok: false, code: 'nameRequired' };
  if (details?.displayName === 'too_long') return { ok: false, code: 'nameTooLong' };
  if (details?.bio === 'too_long') return { ok: false, code: 'bioTooLong' };
  return { ok: false, code: 'generic' };
}

/**
 * `PATCH /v1/me/profile { displayName, bio }` (D-46: the rename is free, leaves no history and never
 * touches `users.name`). The bio is normalised and length-checked by `updateProfileBodySchema`
 * itself, in UTF-16 code units — the same unit the browser counter and `maxLength` count, so a value
 * the counter accepted is never refused here.
 *
 * The photo is NOT part of this action: it commits on upload completion through `setAvatarAction`,
 * so a member who only changes their photo never presses "Salvar alterações" (UI-SPEC §Edit profile).
 */
export async function saveProfileAction(input: {
  displayName: string;
  bio: string;
}): Promise<SaveProfileResult> {
  const body = updateProfileBodySchema.safeParse({
    displayName: input.displayName,
    bio: input.bio,
  });
  if (!body.success) {
    const issue = body.error.issues.find((i) => i.path.length > 0);
    const field = String(issue?.path[0] ?? '');
    if (field === 'displayName') {
      return issue?.message === 'required'
        ? { ok: false, code: 'nameRequired' }
        : { ok: false, code: 'nameTooLong' };
    }
    if (field === 'bio') return { ok: false, code: 'bioTooLong' };
    return { ok: false, code: 'generic' };
  }

  let refusal: string | null = null;
  let result: SaveProfileResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch('/v1/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true };
      revalidateProfile();
    } else {
      const envelope = await readEnvelope(res);
      if (res.status === 400) {
        result = profileIssueCode(envelope?.details);
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal)
          console.error('profile.save_failed', { status: res.status, code: envelope?.code });
      }
    }
  } catch (error) {
    console.error('profile.save_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
