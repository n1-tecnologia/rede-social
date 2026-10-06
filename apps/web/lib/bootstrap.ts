import { type ApiErrorEnvelope, type Bootstrap, bootstrapSchema } from '@rede-social/contracts';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';

/** Non-2xx API answer, carrying the stable envelope code every screen switches on (D-09). */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(`API ${status} ${code}`);
    this.name = 'ApiClientError';
  }
}

async function readEnvelope(res: Response): Promise<ApiErrorEnvelope['error'] | null> {
  try {
    const body = (await res.json()) as Partial<ApiErrorEnvelope>;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * `GET /v1/me/bootstrap`, deduplicated per request render (React `cache`): the `(app)` layout and
 * `/inicio` share one call. Throws `ApiClientError` on any non-2xx.
 *
 * Screens do not call this directly: they go through `requireBootstrap()`, which turns the 401/403
 * refusals into navigations. The App Router renders the layout and the page CONCURRENTLY and both
 * await this same cached promise, so if only one of them mapped the rejection to `redirect()` the
 * other segment would be left with an unhandled `ApiClientError` — logged by Next as a render error
 * (and shipped to Sentry) even though the user only ever sees the redirect.
 */
export const getBootstrap = cache(async (): Promise<Bootstrap> => {
  const res = await apiFetch('/v1/me/bootstrap');
  if (!res.ok) {
    const error = await readEnvelope(res);
    throw new ApiClientError(
      res.status,
      error?.code ?? 'HTTP_ERROR',
      error?.details,
      error?.requestId,
    );
  }
  return bootstrapSchema.parse(await res.json());
});

/**
 * The ONE mechanism that turns an API refusal into a navigation. Runs `load()`; when it rejects with
 * an `ApiClientError` that `redirectPathFor` knows, redirects there. Anything else — a non-API error,
 * an unknown envelope code, a 5xx — is rethrown untouched so it still surfaces as a real render error
 * and never silently renders the private shell.
 *
 * `redirect()` throws NEXT_REDIRECT, so per the Next 16 rule it is called AFTER the try/catch, never
 * inside the `try` (the catch would swallow the navigation).
 */
export async function loadOrRedirect<T>(
  load: () => Promise<T>,
  redirectPathFor: (error: ApiClientError) => string | null,
): Promise<T> {
  let path: string;
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    const target = redirectPathFor(error);
    if (target === null) throw error;
    path = target;
  }
  redirect(path);
}

/**
 * Bootstrap refusal -> where the member goes. Server Components cannot clear cookies themselves, so
 * each 403 is routed to a Route Handler under `/auth/*` that signs the device out and then lands on
 * the public screen.
 *
 * - 401: expired/invalid session between proxy.ts and the API — back to login.
 * - `MEMBERSHIP_BLOCKED` (AUTH-06 / D-09): the block takes effect on the very next request. The tenant
 *   display name is the only detail the 403 carries and the only one the screen shows.
 * - `TENANT_SUSPENDED` (D-32): the TENANT, not the member, is unavailable; the device is signed out
 *   like D-09 and lands on the branded public screen `/comunidade-indisponivel`. No query — the brand
 *   comes from the host and the copy names no tenant, reason or timestamp.
 * - `TENANT_HOST_MISMATCH` (08.1, D-305): the session holds no membership in THIS tenant host's
 *   community, so it is offered to join it on `/participar` (no query parameters: nothing may name
 *   another community). `/participar` itself routes platform admins and the other join states on.
 * - `NO_MEMBERSHIP`: orphan identity, a session with no membership row.
 * - `MEMBERSHIP_INVITED` (D-29, 02-10): an invited admin's Bearer reached a refused tenant-lane
 *   route before accepting — back to the accept screen (belt and braces next to `requireBootstrap`).
 * - anything else: `null` — the caller rethrows.
 */
export function bootstrapRedirectPath(error: ApiClientError): string | null {
  if (error.status === 401) return '/entrar';
  switch (error.code) {
    case 'MEMBERSHIP_INVITED':
      return '/aceitar-convite';
    case 'MEMBERSHIP_BLOCKED':
      return `/auth/blocked?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
    case 'TENANT_SUSPENDED':
      return '/auth/suspended';
    case 'TENANT_HOST_MISMATCH':
      return '/participar';
    case 'NO_MEMBERSHIP':
      return '/sem-comunidade';
    default:
      return null;
  }
}

/**
 * Where the accept-invite page goes when its bootstrap is refused (D-29). It is the ONE caller that
 * must not use `requireBootstrap()` — that would redirect an invited session to itself. Without a
 * session (401) or without a membership (`NO_MEMBERSHIP`: the invite row was removed, or the link
 * was exchanged for an identity that no longer belongs anywhere) the honest screen is
 * `/convite-expirado`; every other refusal follows `bootstrapRedirectPath`.
 */
export function acceptInviteRedirectPath(error: ApiClientError): string | null {
  if (error.status === 401 || error.code === 'NO_MEMBERSHIP') return '/convite-expirado';
  return bootstrapRedirectPath(error);
}

/**
 * The bootstrap every tenant-host screen needs, or a redirect. Both the `(app)` layout and any page
 * rendered inside it must call THIS (not `getBootstrap`) so that every concurrently rendered segment
 * ends with NEXT_REDIRECT and no segment is left holding an unhandled rejection. The React `cache`
 * on `getBootstrap` still guarantees a single `GET /v1/me/bootstrap` per render.
 *
 * D-29: an invited admin who opens `/inicio`, `/configuracoes` or `/perfil` before accepting the
 * tenant rules and the platform's terms is routed to `/aceitar-convite` — the API answers the bootstrap with
 * `membership.status = 'invited'`, and the guard lives here so no `(app)` segment needs to know.
 * `redirect()` is called outside any try/catch (Next 16 rule).
 */
export async function requireBootstrap(): Promise<Bootstrap> {
  const bootstrap = await loadOrRedirect(getBootstrap, bootstrapRedirectPath);
  if (bootstrap.membership.status === 'invited') redirect('/aceitar-convite');
  return bootstrap;
}
