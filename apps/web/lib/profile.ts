import { type OwnProfile, ownProfileSchema } from '@tria/contracts/profiles';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * `GET /v1/me/profile` (03-02) for the member-facing profile screens, deduplicated per request
 * render (React `cache`) exactly like `getBootstrap` — `/perfil`, `/perfil/editar` and 03-05's nudge
 * all read THIS, so the screen and the shell never disagree about the same row.
 *
 * The payload carries `avatarAssetId` plus the STABLE `/v1/media/{assetId}/w128` path, never a signed
 * Storage URL (R-05/TENANT-04): the tenant check runs on every image fetch and a cached payload can
 * never outlive its URLs.
 */
export const getOwnProfile = cache(async (): Promise<OwnProfile> => {
  const res = await apiFetch('/v1/me/profile');
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; details?: Record<string, unknown> };
      };
      if (typeof body?.error?.code === 'string') code = body.error.code;
      details = body?.error?.details;
    } catch {
      // A non-JSON body keeps the generic code — the screen's error state is the same either way.
    }
    throw new ApiClientError(res.status, code, details);
  }
  return ownProfileSchema.parse(await res.json());
});

/**
 * The profile a screen renders, or `null`. A refusal `bootstrapRedirectPath` knows (401, blocked,
 * suspended, host mismatch, no membership) becomes a navigation — performed OUTSIDE the try/catch,
 * since `redirect()` throws (Next 16 rule) and a catch would swallow it. Anything else is logged
 * once and answered with `null`, so the screen renders its own "Tentar novamente" empty state
 * (UI-SPEC E1/error) instead of the app-level error page.
 */
export async function loadOwnProfile(): Promise<OwnProfile | null> {
  let path: string | null = null;
  let profile: OwnProfile | null = null;
  try {
    profile = await getOwnProfile();
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('profile.load_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return profile;
}
