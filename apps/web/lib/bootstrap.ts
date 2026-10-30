import { type ApiErrorEnvelope, type Bootstrap, bootstrapSchema } from '@rede-social/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { PROFILE_FORM_PATH, REQUEST_PATH_HEADER, safeNextPath } from '@/lib/safe-next-path';

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
 * The validated destination of the current request render, parked for the data loaders' refusals
 * (quick 261030-g1y). One object per request render: React `cache` is the same request-scoped
 * mechanism `getBootstrap` relies on, and it is deliberately NOT a module-level variable, which would
 * leak one member's destination into a concurrent request. Outside a render (a route handler, a unit
 * test on the default React build) `cache` returns a fresh object on every call, so nothing persists
 * and the slot reads as empty.
 */
const renderDestination = cache((): { next: string | null } => ({ next: null }));

/**
 * Reads the `x-rede-path` header, validates it with `safeNextPath` (the only gate, D-583) and parks the
 * result in `renderDestination()`. The ONLY writer of the slot: only `requireBootstrap` calls it, so a
 * request that never runs the guard never carries a destination.
 */
async function readRenderDestination(): Promise<string | null> {
  const next = safeNextPath((await headers()).get(REQUEST_PATH_HEADER));
  renderDestination().next = next;
  return next;
}

/**
 * Bootstrap refusal -> where the member goes. Server Components cannot clear cookies themselves, so
 * each 403 is routed to a Route Handler under `/auth/*` that signs the device out and then lands on
 * the public screen.
 *
 * - 401: expired/invalid session between proxy.ts and the API — back to login.
 * - `MEMBERSHIP_BLOCKED` (AUTH-06 / D-09): the block takes effect on the very next request. The tenant
 *   display name is the only detail the 403 carries and the only one the screen shows.
 * - `SUBSCRIPTION_PENDING` (09.1-15, D-497, D-499): the member's payment access is cut. They land on
 *   `/assinatura-pendente`, a page in the `(auth)` group with the host brand, and — UNLIKE the blocked
 *   flow — nothing clears the session: the Supabase identity is shared across communities, so only "Sair"
 *   signs out. The tenant name rides along only as the fallback text for a failed read of the screen's own
 *   data; the checkout link is never carried in the URL.
 * - `PROFILE_FORM_PENDING` (12-11, D-581, PFORM-12): the member owes an answer the tenant made required, so
 *   every refused route sends them to `/completar-perfil`. Like the payment cut, nothing clears the session
 *   ("Sair" stays reachable). The tenant name rides along only as the fallback text for a failed read of
 *   the screen's own data. The mapping carries the destination (`&next=`) only when a `requireBootstrap`
 *   in the same request render already read it: a page runs the guard and its data loaders in one
 *   `Promise.all`, and the API gate answers a loader's 403 before the multi-query bootstrap, so the
 *   LOADER's redirect wins the race and must carry the same validated `x-rede-path` as the guard's. One
 *   request-scoped slot fixes every loader at once. A refusal that is not a render (the counters BFF of
 *   an open app, an action that never calls the guard) primes nothing, stays bare and lands on `/inicio`
 *   after saving.
 * - `TENANT_SUSPENDED` (D-32): the TENANT, not the member, is unavailable; the device is signed out
 *   like D-09 and lands on the branded public screen `/comunidade-indisponivel`. No query — the brand
 *   comes from the host and the copy names no tenant, reason or timestamp.
 * - `TENANT_UPDATING` / `TENANT_PREPARING` / `TENANT_UNAVAILABLE` (09.2-21, UI-D-542, D-535, D-545):
 *   the community's database is being updated, is still being prepared, or is paused or unreachable.
 *   Nothing was decided about this member, so — UNLIKE `TENANT_SUSPENDED` — they go DIRECTLY to their
 *   public screen (`/comunidade-em-atualizacao`, `/comunidade-em-preparacao`, and the shipped
 *   `/comunidade-indisponivel` for the third, the same sentence as a suspension, A-UI-8) and never
 *   through `/auth/suspended`: no route handler clears a cookie for these, so a migration is not a
 *   logout. The codes carry no details and the screens take no query.
 * - `TENANT_HOST_MISMATCH` (08.1, D-305): the session holds no membership in THIS tenant host's
 *   community, so it is offered to join it on `/participar` (no query parameters: nothing may name
 *   another community). `/participar` itself routes platform admins and the other join states on.
 * - `TENANT_CHOICE_REQUIRED` (08.1-03, D-308, GENERIC hosts only — localhost, Vercel Preview): the
 *   identity holds more than one selectable membership and no valid `tenant_slug` choice, so it picks
 *   one on `/escolher-comunidade`. A tenant host never produces this code (the host decides there).
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
    case 'SUBSCRIPTION_PENDING':
      return `/assinatura-pendente?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
    case 'PROFILE_FORM_PENDING': {
      const base = `${PROFILE_FORM_PATH}?t=${encodeURIComponent(String(error.details?.tenantName ?? ''))}`;
      const next = renderDestination().next;
      return next ? `${base}&next=${encodeURIComponent(next)}` : base;
    }
    case 'TENANT_SUSPENDED':
      return '/auth/suspended';
    case 'TENANT_UPDATING':
      return '/comunidade-em-atualizacao';
    case 'TENANT_PREPARING':
      return '/comunidade-em-preparacao';
    case 'TENANT_UNAVAILABLE':
      return '/comunidade-indisponivel';
    case 'TENANT_HOST_MISMATCH':
      return '/participar';
    case 'TENANT_CHOICE_REQUIRED':
      return '/escolher-comunidade';
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
 *
 * 12-11 (D-581, D-583): a member whose bootstrap carries `profileForm.pendingRequired > 0` is sent to the
 * form BEFORE any `(app)` segment renders, so the first paint after login is the form and not a flash of
 * Início. The destination they were headed for is the `x-rede-path` request header `proxy.ts` sets from
 * the request's own URL; it is validated by `safeNextPath` here and again by the form's page, and a
 * rejected value is simply left out. The completion page itself never calls this function (it would
 * redirect to itself, RESEARCH Pitfall 2).
 *
 * The header is read FIRST, before the bootstrap is awaited (quick 261030-g1y): a data loader running
 * beside this guard in the same `Promise.all` can be refused with `PROFILE_FORM_PENDING` while the
 * bootstrap is still in flight, and its redirect (`bootstrapRedirectPath`) must already find the
 * validated destination in the request-scoped slot.
 */
export async function requireBootstrap(): Promise<Bootstrap> {
  const destination = readRenderDestination();
  // Settled on every path below; this keeps a failed header read from being reported twice.
  destination.catch(() => undefined);
  const bootstrap = await loadOrRedirect(getBootstrap, bootstrapRedirectPath);
  if (bootstrap.membership.status === 'invited') redirect('/aceitar-convite');
  if ((bootstrap.profileForm?.pendingRequired ?? 0) > 0) {
    const next = await destination;
    redirect(next ? `${PROFILE_FORM_PATH}?next=${encodeURIComponent(next)}` : PROFILE_FORM_PATH);
  }
  return bootstrap;
}
