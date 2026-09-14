import { type PlatformTenants, platformTenantsSchema } from '@tria/contracts';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiClientError, loadOrRedirect } from '@/lib/bootstrap';

/**
 * `GET /v1/platform/tenants` (D-21), deduplicated per render by React `cache`: the `(app)` layout
 * and `/inicio` share one call.
 *
 * This call is also the AUTHORISATION of the platform host: only `platform_admins` get a 200, and
 * only off a tenant host (D-23). Anything else throws `ApiClientError`; screens go through
 * `requirePlatformTenants()`, which signs the device out — the web tier never decides who is a super
 * admin from claims.
 */
export const getPlatformTenants = cache(async (): Promise<PlatformTenants> => {
  const res = await apiFetch('/v1/platform/tenants');
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let details: Record<string, unknown> | undefined;
    let requestId: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      };
      if (typeof body?.error?.code === 'string') {
        code = body.error.code;
        details = body.error.details;
        requestId = body.error.requestId;
      }
    } catch {
      // Non-JSON body (proxy error page): the status alone decides what the layout does.
    }
    throw new ApiClientError(res.status, code, details, requestId);
  }
  return platformTenantsSchema.parse(await res.json());
});

/**
 * Platform refusal -> where the session goes. 401: back to login. A member (403 `FORBIDDEN`) or a
 * platform session that wandered onto a tenant host (403 `TENANT_HOST_MISMATCH`) is signed out by the
 * same `/auth/host-mismatch` Route Handler the tenant branch uses, with no query string, so the screen
 * names no tenant (D-23). Anything else: `null` — the caller rethrows.
 */
export function platformRedirectPath(error: ApiClientError): string | null {
  if (error.status === 401) return '/entrar';
  if (error.code === 'FORBIDDEN' || error.code === 'TENANT_HOST_MISMATCH') {
    return '/auth/host-mismatch';
  }
  return null;
}

/**
 * The tenant list every platform-host screen needs, or a redirect. D-21/D-23: the platform host is
 * authorised by the API, never by claims — a 200 from `/v1/platform/tenants` IS the proof this session
 * is a platform_admin on the right host. Both the `(app)` layout and the page rendered inside it must
 * call THIS (not `getPlatformTenants`) so every concurrently rendered segment ends with NEXT_REDIRECT;
 * the React `cache` on `getPlatformTenants` still guarantees a single call per render.
 */
export async function requirePlatformTenants(): Promise<PlatformTenants> {
  return loadOrRedirect(getPlatformTenants, platformRedirectPath);
}
