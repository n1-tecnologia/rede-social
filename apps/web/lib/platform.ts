import { type PlatformTenants, platformTenantsSchema } from '@tria/contracts';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';

/**
 * `GET /v1/platform/tenants` (D-21), deduplicated per render by React `cache`: the `(app)` layout
 * and `/inicio` share one call.
 *
 * This call is also the AUTHORISATION of the platform host: only `platform_admins` get a 200, and
 * only off a tenant host (D-23). Anything else throws `ApiClientError` and the layout signs the
 * device out — the web tier never decides who is a super admin from claims.
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
