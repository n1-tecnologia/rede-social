import {
  MEDIA_LIST_PAGE_SIZE,
  type MediaList,
  type MediaPlayback,
  mediaListSchema,
  mediaPlaybackSchema,
} from '@tria/contracts/media';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * `GET /v1/media` and `GET /v1/media/{assetId}/playback` for the admin media screen (MEDIA-03),
 * in `lib/profile.ts`'s conventions: ONE implementation shared by the server page and the server
 * actions, so the first page and "Carregar mais" can never disagree about the page size or the
 * tenant the request is scoped to.
 *
 * `apiFetch` is what keeps this honest about tenancy: the caller's session and the browser's host
 * travel with the request and the API re-derives the tenant from them, so nothing handed in here
 * can widen what may be read.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The query the media screen sends; `cursor` is OPAQUE and is forwarded verbatim (T-03-34). */
export type MediaQuery = { kind?: string; purpose?: string; cursor?: string; limit?: number };

export async function getMediaAssets(query: MediaQuery = {}): Promise<MediaList> {
  const search = new URLSearchParams();
  if (query.kind) search.set('kind', query.kind);
  if (query.purpose) search.set('purpose', query.purpose);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? MEDIA_LIST_PAGE_SIZE));

  const res = await apiFetch(`/v1/media?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return mediaListSchema.parse(await res.json());
}

/**
 * One page of the library, or `null` when the API could not answer — the screen then renders its own
 * retry affordance rather than the app-level error page. A refusal `bootstrapRedirectPath` knows
 * becomes a navigation, performed OUTSIDE the try/catch (Next 16: `redirect()` throws).
 *
 * A 403 is deliberately NOT special-cased into a screen: the page has already checked the role and
 * `notFound()`ed, so a 403 here means the two disagreed and the redirect path is the right answer.
 */
export async function loadMediaAssets(query: MediaQuery = {}): Promise<MediaList | null> {
  let path: string | null = null;
  let page: MediaList | null = null;
  try {
    page = await getMediaAssets(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('media.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/**
 * A freshly minted playback credential. **The value is returned to the caller's closure and must
 * never be cached, stored or logged** (D-44): it is a bearer credential valid at the provider's
 * edge, and the API answers it `no-store` for the same reason.
 */
export async function getPlaybackTokens(assetId: string): Promise<MediaPlayback> {
  const res = await apiFetch(`/v1/media/${encodeURIComponent(assetId)}/playback`);
  if (!res.ok) throw await apiError(res);
  return mediaPlaybackSchema.parse(await res.json());
}
