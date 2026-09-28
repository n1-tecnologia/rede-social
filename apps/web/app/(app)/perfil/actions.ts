'use server';

import {
  MEDIA_ISSUES,
  type MediaAsset,
  type MediaIssue,
  mediaAssetSchema,
  mediaStartBodySchema,
  mediaStartSchema,
} from '@rede-social/contracts/media';
import { updateProfileBodySchema } from '@rede-social/contracts/profiles';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
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

const assetIdSchema = z.uuid();

/** The media refusal vocabulary (`MEDIA_ISSUES`) as the hook receives it, plus the catch-all. */
export type MediaActionCode = MediaIssue | 'generic';

function mediaIssueOf(details: Record<string, unknown> | undefined): MediaIssue | null {
  const issue = details?.media;
  return typeof issue === 'string' && (MEDIA_ISSUES as readonly string[]).includes(issue)
    ? (issue as MediaIssue)
    : null;
}

export type StartMediaUploadResult =
  | {
      ok: true;
      upload: {
        assetId: string;
        /** Which broker owns the object — the transfer router in `lib/upload.ts` branches on it. */
        provider: string;
        signedUrl: string;
        token: string | null;
        path: string | null;
        resumableThresholdBytes: number;
        maxBytes: number;
      };
    }
  | { ok: false; code: MediaActionCode; maxBytes?: number };

/**
 * `POST /v1/media/uploads` (MEDIA-01): `{ kind, purpose, mime, size, filename }` cross here — NEVER
 * file bytes. The answer is a TARGET (a signed Storage URL plus, above 6 MiB, the TUS token and
 * object path); the browser sends the bytes to it directly, so nothing ever hits the Next server or
 * Cloud Run's 32 MiB body cap. The token lives in the caller's closure for the transfer only: it is
 * never rendered, stored or logged (T-03-25).
 */
export async function startMediaUploadAction(input: {
  kind: string;
  purpose: string;
  mime: string;
  size: number;
  filename?: string;
}): Promise<StartMediaUploadResult> {
  const body = mediaStartBodySchema.safeParse(input);
  if (!body.success) {
    const paths = body.error.issues.map((issue) => issue.path.map(String).join('.'));
    return { ok: false, code: paths.includes('size') ? 'too_large' : 'type_not_allowed' };
  }

  let refusal: string | null = null;
  let result: StartMediaUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch('/v1/media/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      const start = mediaStartSchema.parse(await res.json());
      result = {
        ok: true,
        upload: {
          assetId: start.assetId,
          provider: start.provider,
          signedUrl: start.signedUrl,
          token: start.token,
          path: start.path,
          resumableThresholdBytes: start.resumableThresholdBytes,
          maxBytes: start.maxBytes,
        },
      };
    } else {
      const envelope = await readEnvelope(res);
      const issue = mediaIssueOf(envelope?.details);
      const maxBytes = envelope?.details?.maxBytes;
      if (issue) {
        result = {
          ok: false,
          code: issue,
          ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
        };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('media.start_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('media.start_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export type CompleteMediaUploadResult =
  | { ok: true; asset: MediaAsset }
  | { ok: false; code: MediaActionCode; maxBytes?: number };

/**
 * `POST /v1/media/uploads/{assetId}/complete` (no body): the API re-reads the object's Storage
 * metadata and decodes its image header, so a spoofed mime or a non-image is refused HERE — the
 * client's pick-time check was only UX (T-03-28). A refused object is already removed server-side.
 */
export async function completeMediaUploadAction(
  assetId: string,
): Promise<CompleteMediaUploadResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CompleteMediaUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(`/v1/media/uploads/${encodeURIComponent(id.data)}/complete`, {
      method: 'POST',
    });
    if (res.ok) {
      result = { ok: true, asset: mediaAssetSchema.parse(await res.json()) };
    } else {
      const envelope = await readEnvelope(res);
      const issue = mediaIssueOf(envelope?.details);
      const maxBytes = envelope?.details?.maxBytes;
      if (issue) {
        result = { ok: false, code: issue, ...(typeof maxBytes === 'number' ? { maxBytes } : {}) };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('media.complete_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('media.complete_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export type AvatarResult = { ok: true } | { ok: false; code: 'invalid' | 'generic' };

/** `PATCH /v1/me/profile { avatarAssetId }` — the ONE write that changes the member's photo. */
async function patchAvatar(avatarAssetId: string | null): Promise<AvatarResult> {
  const body = updateProfileBodySchema.safeParse({ avatarAssetId });
  if (!body.success) return { ok: false, code: 'invalid' };

  let refusal: string | null = null;
  let result: AvatarResult = { ok: false, code: 'generic' };
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
        result = { ok: false, code: envelope?.details?.avatarAssetId ? 'invalid' : 'generic' };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('profile.avatar_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('profile.avatar_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Commits a freshly uploaded photo as the member's avatar — run straight after `complete`, which is
 * why the photo never waits for "Salvar alterações". The API retires the previous asset itself, so
 * the form holds no pending photo state and an abandoned form leaves no half-applied change.
 */
export async function setAvatarAction(assetId: string): Promise<AvatarResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'invalid' };
  return patchAvatar(id.data);
}

/** Clears the photo (`{ avatarAssetId: null }`): the profile goes back to the neutral icon. */
export async function removeAvatarAction(): Promise<AvatarResult> {
  return patchAvatar(null);
}

export type DismissNudgeResult = { ok: true } | { ok: false; code: 'generic' };

/**
 * `POST /v1/me/profile/dismiss-nudge` — "Agora não" on the D-02 card (R-13).
 *
 * The write is SERVER state (`member_profiles.nudge_dismissed_at`), which is the whole point: an
 * installed PWA whose storage the OS evicts, or the same member on a second device, must not be
 * nagged again. `revalidatePath('/inicio')` is what actually removes the card — the component never
 * removes it optimistically, so a failed dismissal leaves it on screen with an error toast rather
 * than silently pretending it worked and re-nagging on the next load.
 */
export async function dismissNudgeAction(): Promise<DismissNudgeResult> {
  let refusal: string | null = null;
  let result: DismissNudgeResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch('/v1/me/profile/dismiss-nudge', { method: 'POST' });
    if (res.ok) {
      result = { ok: true };
      revalidatePath('/inicio');
      revalidateProfile();
    } else {
      const envelope = await readEnvelope(res);
      refusal = refusalPath(res.status, envelope);
      if (!refusal) {
        console.error('profile.nudge_dismiss_failed', {
          status: res.status,
          code: envelope?.code,
        });
      }
    }
  } catch (error) {
    console.error('profile.nudge_dismiss_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
