import {
  MODERATION_LOG_PAGE_SIZE,
  type ModerationAction,
  type ModerationLogPage,
  moderationLogPageSchema,
} from '@rede-social/contracts/moderation';
import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The moderation log's web client (MODER-03, UI-D-277) — SERVER-ONLY: every call goes through
 * `apiFetch` with the session's Bearer and the tenant host, so the browser never talks to the API and
 * never holds a token. The API decides everything: the tenant is the membership of record and the
 * permission is `moderation.manage` (D-338); nothing here is an authority.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body (the `media.ts` helper). */
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
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

export type ModerationLogRequest = { action?: ModerationAction; cursor?: string };

/** `GET /v1/admin/moderation-log` — one keyset page, newest first. `cursor` is opaque (forwarded). */
export async function getModerationLog(
  query: ModerationLogRequest = {},
): Promise<ModerationLogPage> {
  const search = new URLSearchParams();
  if (query.action) search.set('action', query.action);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(MODERATION_LOG_PAGE_SIZE));

  const res = await apiFetch(`/v1/admin/moderation-log?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return moderationLogPageSchema.parse(await res.json());
}

/**
 * The page's loader. Session and membership refusals follow the shipped bootstrap mapping (401 →
 * `/entrar`, blocked → the "Acesso suspenso" screen, …). A 403 `FORBIDDEN` means the permission was
 * lost since the bootstrap was read (UI-D-284): the screen answers `notFound()`, exactly as it does for
 * a member who types the URL. Any other failure answers `null`, which the page renders as its error
 * state. `redirect` and `notFound` throw, so both sit OUTSIDE the try/catch (Next 16 rule).
 */
export async function loadModerationLog(
  query: ModerationLogRequest = {},
): Promise<ModerationLogPage | null> {
  let path: string | null = null;
  let forbidden = false;
  let page: ModerationLogPage | null = null;
  try {
    page = await getModerationLog(query);
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      forbidden = error.status === 403 && error.code === 'FORBIDDEN';
    }
    if (!path && !forbidden) console.error('moderation.log.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  if (forbidden) notFound();
  return page;
}
